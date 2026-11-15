// Builds the rule Context (docs/SPEC.md §8) from the chain the vault runs on. This is the only place the rule
// inputs touch the network; the rules themselves stay pure.
import { getAddress, type Address, type PublicClient } from "viem";
import { agentVaultAbi, mockOracleAbi, type Deployment } from "@guardian402/shared";
import type {
  Context,
  ExplorerInfo,
  KnownContract,
  LimitsSnapshot,
  OracleReference,
  PolicySnapshot,
} from "./rules/types.ts";

export async function readPolicy(client: PublicClient, vault: Address): Promise<PolicySnapshot> {
  const [p, limits] = await Promise.all([
    client.readContract({ address: vault, abi: agentVaultAbi, functionName: "getPolicy" }),
    readLimits(client, vault),
  ]);
  return {
    owner: p.owner,
    agent: p.agent,
    guardian: p.guardian,
    paused: p.paused,
    verdictNonce: p.verdictNonce,
    maxAgentRisk: Number(p.maxAgentRisk),
    day: p.day,
    tokens: p.tokens.map((t) => ({
      token: t.token,
      dailyCap: t.dailyCap,
      maxApproval: t.maxApproval,
      verdictThreshold: t.verdictThreshold,
      spentToday: t.spentToday,
      balance: t.balance,
    })),
    nativeDailyCap: p.nativeDailyCap,
    nativeVerdictThreshold: p.nativeVerdictThreshold,
    nativeSpentToday: p.nativeSpentToday,
    nativeBalance: p.nativeBalance,
    targets: p.targets.map((t) => ({ target: t.target, selectors: [...t.selectors] })),
    recipients: [...p.recipients],
    ...(limits ? { limits } : {}),
  };
}

/** AgentVault.getLimits(), or undefined for a vault deployed before per-batch caps and budgets (SPEC §4.9). */
async function readLimits(client: PublicClient, vault: Address): Promise<LimitsSnapshot[] | undefined> {
  try {
    const l = await client.readContract({ address: vault, abi: agentVaultAbi, functionName: "getLimits" });
    return l.map((x) => ({
      token: x.token,
      maxPerTx: x.maxPerTx,
      budget: x.budget,
      spentSinceReset: x.spentSinceReset,
    }));
  } catch {
    return undefined;
  }
}

/** MockOracle reference for ABNORMAL_SLIPPAGE: USDC (quote, 6 decimals) per 1 mWAVAX (base, 18 decimals). */
export async function readOracle(client: PublicClient, d: Deployment): Promise<OracleReference> {
  const price = await client.readContract({ address: d.oracle, abi: mockOracleAbi, functionName: "price" });
  return { base: d.mWAVAX, baseDecimals: 18, quote: d.usdc, price };
}

/** The subset of `addresses` that has code. */
export async function withCode(client: PublicClient, addresses: readonly Address[]): Promise<Address[]> {
  const unique = [...new Map(addresses.map((a) => [a.toLowerCase(), getAddress(a)])).values()];
  const codes = await Promise.all(unique.map((address) => client.getCode({ address })));
  return unique.filter((_, i) => {
    const code = codes[i];
    return code !== undefined && code !== "0x";
  });
}

export type ContextInput = {
  vault: Address;
  policy: PolicySnapshot;
  knownContracts: Record<string, KnownContract>;
  contracts: Address[];
  oracle?: OracleReference;
  addressBook?: Address[];
  /** Explorer facts for unknown contracts (flagged lookup, never in tests or eval). Lowercase keys. */
  explorer?: Record<string, ExplorerInfo>;
  demoMode: boolean;
  subject?: "vault" | "wallet";
};

export function buildContext(input: ContextInput): Context {
  return {
    vault: input.vault,
    policy: input.policy,
    knownContracts: input.knownContracts,
    contracts: input.contracts,
    addressBook: input.addressBook ?? [],
    demoMode: input.demoMode,
    ...(input.oracle ? { oracle: input.oracle } : {}),
    ...(input.explorer ? { explorer: input.explorer } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
  };
}
