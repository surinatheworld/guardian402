// What the vault workspace needs from the outside world, as two small interfaces: the chain (AgentVault reads
// and transaction lookups) and the Guardian API (its checks). The business rules in workspace.ts depend only on
// these, so tests pass in fakes; the real adapters below use viem and fetch.
import { createPublicClient, isAddressEqual, parseEventLogs, type Address, type Hex } from "viem";
import { agentVaultAbi, fujiChain, rpcTransport } from "@guardian402/shared";
import { RPC_URL } from "@/lib/config";
import { guardianUpstream } from "./upstream";
import type { OnChainPolicy } from "@/lib/policy-spec";
import { AccountError } from "./accounts";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** One Guardian check, as listed by GET /v1/checks. */
export type GuardianCheck = {
  checkId: string;
  createdAt: number;
  endpoint: string;
  vault: string;
  risk: RiskLevel;
  score: number;
  ruleIds: string[];
  explanation: { vi: string; en: string; source: string } | null;
  paymentTx: string | null;
};

export type TxLookup =
  | { found: false }
  | {
      found: true;
      from: Address;
      to: Address | null;
      input: Hex;
      status: "pending" | "success" | "reverted";
    };

export interface ChainPort {
  vaultOwner(vault: Address): Promise<Address>;
  vaultAgent(vault: Address): Promise<Address>;
  allowlisted(vault: Address, address: Address): Promise<{ recipient: boolean; target: boolean }>;
  /** Daily cap and what is left today for `token` (base units); null when the token is not tracked. */
  capUsage(vault: Address, token: Address): Promise<{ dailyCap: bigint; remaining: bigint } | null>;
  transaction(hash: Hex): Promise<TxLookup>;
  /** AgentVault.getPolicy(): agent, guardian, limits, allowlists and today's spending. */
  vaultPolicy(vault: Address): Promise<OnChainPolicy>;
  /** A transaction and the vault's Executed event in it, if any. */
  execution(vault: Address, hash: Hex): Promise<ExecutionLookup>;
}

export type ExecutionLookup =
  | { found: false }
  | {
      found: true;
      from: Address;
      to: Address | null;
      status: "pending" | "success" | "reverted";
      blockNumber: string | null;
      executed: { checkId: Hex; withVerdict: boolean; nonce: string } | null;
    };

export interface GuardianPort {
  /** Recent checks of all vaults (the Guardian has no per-vault filter); throws when unreachable. */
  /** `vault`: only that vault's checks (filtered by the Guardian). */
  recentChecks(limit: number, vault?: Address): Promise<GuardianCheck[]>;
  /** One check by id, or null when the Guardian does not know it. */
  check(checkId: string): Promise<GuardianCheck | null>;
}

// ------------------------------------------------------------------ real adapters

const TIMEOUT_MS = 10_000;
const unavailable = (what: string) =>
  new AccountError(
    503,
    `${what}_unavailable`,
    `Không đọc được ${what === "chain" ? "chain" : "Guardian"} lúc này. Thử lại sau.`,
  );

async function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable(what)), TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (e instanceof Error && e.name === "AccountError") throw e;
    throw unavailable(what);
  } finally {
    clearTimeout(timer);
  }
}

const client = createPublicClient({ chain: fujiChain, transport: rpcTransport(RPC_URL) });

export const chainPort: ChainPort = {
  vaultOwner: (vault) =>
    withTimeout(client.readContract({ address: vault, abi: agentVaultAbi, functionName: "owner" }), "chain"),
  vaultAgent: (vault) =>
    withTimeout(client.readContract({ address: vault, abi: agentVaultAbi, functionName: "agent" }), "chain"),
  allowlisted: (vault, address) =>
    withTimeout(
      Promise.all([
        client.readContract({
          address: vault,
          abi: agentVaultAbi,
          functionName: "allowedRecipient",
          args: [address],
        }),
        client.readContract({
          address: vault,
          abi: agentVaultAbi,
          functionName: "allowedTarget",
          args: [address],
        }),
      ]).then(([recipient, target]) => ({ recipient, target })),
      "chain",
    ),
  capUsage: (vault, token) =>
    withTimeout(
      Promise.all([
        client.readContract({
          address: vault,
          abi: agentVaultAbi,
          functionName: "tokenPolicy",
          args: [token],
        }),
        client.readContract({
          address: vault,
          abi: agentVaultAbi,
          functionName: "remainingToday",
          args: [token],
        }),
      ]).then(([[tracked, dailyCap], remaining]) => (tracked ? { dailyCap, remaining } : null)),
      "chain",
    ),
  transaction: (hash) =>
    withTimeout(
      (async (): Promise<TxLookup> => {
        const tx = await client.getTransaction({ hash }).catch(() => null);
        if (!tx) return { found: false };
        const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
        return {
          found: true,
          from: tx.from,
          to: tx.to,
          input: tx.input,
          status: !receipt ? "pending" : receipt.status === "success" ? "success" : "reverted",
        };
      })(),
      "chain",
    ),
  vaultPolicy: (vault) =>
    withTimeout(
      Promise.all([
        client.readContract({ address: vault, abi: agentVaultAbi, functionName: "getPolicy" }),
        // Vaults deployed before SPEC §4.9 have no getLimits().
        client
          .readContract({ address: vault, abi: agentVaultAbi, functionName: "getLimits" })
          .catch(() => undefined),
      ]).then(([p, limits]): OnChainPolicy => ({
        agent: p.agent,
        guardian: p.guardian,
        paused: p.paused,
        maxAgentRisk: p.maxAgentRisk,
        tokens: p.tokens.map((t) => ({
          token: t.token,
          dailyCap: t.dailyCap,
          maxApproval: t.maxApproval,
          verdictThreshold: t.verdictThreshold,
          spentToday: t.spentToday,
        })),
        nativeDailyCap: p.nativeDailyCap,
        nativeVerdictThreshold: p.nativeVerdictThreshold,
        nativeSpentToday: p.nativeSpentToday,
        targets: p.targets.map((t) => ({ target: t.target, selectors: [...t.selectors] })),
        recipients: [...p.recipients],
        ...(limits ? { limits: limits.map((l) => ({ ...l })) } : {}),
      })),
      "chain",
    ),
  execution: (vault, hash) =>
    withTimeout(
      (async (): Promise<ExecutionLookup> => {
        const tx = await client.getTransaction({ hash }).catch(() => null);
        if (!tx) return { found: false };
        const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
        const event = receipt
          ? parseEventLogs({ abi: agentVaultAbi, eventName: "Executed", logs: receipt.logs }).find((l) =>
              isAddressEqual(l.address, vault),
            )
          : undefined;
        return {
          found: true,
          from: tx.from,
          to: tx.to,
          status: !receipt ? "pending" : receipt.status === "success" ? "success" : "reverted",
          blockNumber: receipt ? receipt.blockNumber.toString() : null,
          executed: event
            ? {
                checkId: event.args.checkId,
                withVerdict: event.args.withVerdict,
                nonce: event.args.nonceUsed.toString(),
              }
            : null,
        };
      })(),
      "chain",
    ),
};

async function guardianJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${guardianUpstream()}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw unavailable("guardian");
  return (await res.json()) as T;
}

export const guardianPort: GuardianPort = {
  recentChecks: async (limit, vault) =>
    (
      await withTimeout(
        guardianJson<{ checks: GuardianCheck[] }>(
          `/v1/checks?limit=${limit}${vault ? `&vault=${vault}` : ""}`,
        ),
        "guardian",
      )
    )?.checks ?? [],
  check: async (checkId) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(checkId)) return null;
    // The single-check route returns full findings instead of ruleIds.
    const row = await withTimeout(
      guardianJson<GuardianCheck & { findings?: { ruleId: string }[] }>(`/v1/checks/${checkId}`),
      "guardian",
    );
    if (!row || typeof row.vault !== "string") return null;
    const { findings, ...rest } = row;
    return {
      ...rest,
      ruleIds: row.ruleIds ?? [...new Set((findings ?? []).map((f) => f.ruleId))],
      paymentTx: row.paymentTx ?? null,
      explanation: row.explanation ?? null,
    };
  },
};

export const sameAddress = (a: string, b: string) => {
  try {
    return isAddressEqual(a as Address, b as Address);
  } catch {
    return false;
  }
};
