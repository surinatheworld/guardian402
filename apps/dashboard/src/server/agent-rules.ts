// The rules an agent must follow, read from its vault on chain (the vault is the rule book: SPEC §4.9, §4.10).
// `GET /api/agent/v1/me` and the agent MCP tool `get_rules` return them twice: as numbers for code, and as plain
// English sentences ("guideline") an LLM agent can follow before it asks the Guardian to approve a payment.
import { formatUnits, type Address } from "viem";
import { tokenMeta } from "@/lib/config";
import type { OnChainPolicy } from "@/lib/policy-spec";

const ZERO = "0x0000000000000000000000000000000000000000";
const RISK = ["LOW", "MEDIUM", "HIGH"] as const;

export type TokenRules = {
  token: Address | "native";
  symbol: string;
  decimals: number;
  dailyCap: string;
  spentToday: string;
  leftToday: string;
  /** "0" = no per-transaction cap. */
  maxPerTx: string;
  /** "0" = no budget. */
  budget: string;
  spentSinceReset: string;
  /** null without a budget. */
  budgetLeft: string | null;
  /** Direct transfers above this need a Guardian approval. */
  approvalAbove: string;
};

export type VaultRules = {
  paused: boolean;
  maxRisk: (typeof RISK)[number];
  tokens: TokenRules[];
  recipients: { address: Address; name: string | null }[];
  apps: { address: Address; name: string | null; functions: string[] }[];
};

const left = (cap: bigint, used: bigint) => (cap > used ? cap - used : 0n);

/** Raw on-chain numbers as base-unit strings, plus names the owner gave addresses. */
export function vaultRules(c: OnChainPolicy, nameOf: (a: Address) => string | null): VaultRules {
  const limitsOf = (token: string) => c.limits?.find((l) => l.token.toLowerCase() === token.toLowerCase());
  const token = (
    key: Address | "native",
    meta: { symbol: string; decimals: number },
    dailyCap: bigint,
    spentToday: bigint,
    threshold: bigint,
  ): TokenRules => {
    const l = limitsOf(key === "native" ? ZERO : key);
    const budget = l?.budget ?? 0n;
    const since = l?.spentSinceReset ?? 0n;
    return {
      token: key,
      symbol: meta.symbol,
      decimals: meta.decimals,
      dailyCap: dailyCap.toString(),
      spentToday: spentToday.toString(),
      leftToday: left(dailyCap, spentToday).toString(),
      maxPerTx: (l?.maxPerTx ?? 0n).toString(),
      budget: budget.toString(),
      spentSinceReset: since.toString(),
      budgetLeft: budget > 0n ? left(budget, since).toString() : null,
      approvalAbove: threshold.toString(),
    };
  };
  return {
    paused: c.paused,
    maxRisk: RISK[Math.min(c.maxAgentRisk, 2)] ?? "LOW",
    tokens: [
      ...c.tokens.map((t) =>
        token(t.token, tokenMeta(t.token), t.dailyCap, t.spentToday, t.verdictThreshold),
      ),
      token(
        "native",
        { symbol: "AVAX", decimals: 18 },
        c.nativeDailyCap,
        c.nativeSpentToday,
        c.nativeVerdictThreshold,
      ),
    ],
    recipients: c.recipients.map((a) => ({ address: a, name: nameOf(a) })),
    apps: c.targets.map((t) => ({ address: t.target, name: nameOf(t.target), functions: [...t.selectors] })),
  };
}

const amount = (raw: string, t: TokenRules) => `${formatUnits(BigInt(raw), t.decimals)} ${t.symbol}`;

/** The same rules as sentences for an LLM agent. Only what changes what the agent should do. */
export function guideline(r: VaultRules): string[] {
  if (r.paused)
    return ["The vault is LOCKED by its owner. Do not try to pay: every payment will be rejected."];
  const out: string[] = [];
  const who = r.recipients.map((x) => (x.name ? `${x.name} (${x.address})` : x.address));
  out.push(
    who.length
      ? `You may only send money to these addresses: ${who.join(", ")}. Any other recipient is rejected.`
      : "No recipient is allowed yet: ask the owner to add one before paying anyone.",
  );
  for (const t of r.tokens) {
    if (t.token === "native" && t.dailyCap === "0") continue;
    if (t.dailyCap === "0") {
      out.push(`${t.symbol}: spending is not allowed.`);
      continue;
    }
    const parts = [`at most ${amount(t.dailyCap, t)} per day (${amount(t.leftToday, t)} left today)`];
    if (t.maxPerTx !== "0") parts.push(`at most ${amount(t.maxPerTx, t)} per transaction`);
    if (t.budgetLeft !== null)
      parts.push(
        t.budgetLeft === "0"
          ? `the total budget of ${amount(t.budget, t)} is used up: stop and ask the owner to reset it`
          : `${amount(t.budgetLeft, t)} left of a total budget of ${amount(t.budget, t)}`,
      );
    out.push(`${t.symbol}: ${parts.join("; ")}.`);
  }
  if (r.apps.length) {
    out.push(
      `You may call these contracts: ${r.apps.map((a) => a.name ?? a.address).join(", ")}. Payments through them always need a Guardian approval.`,
    );
  }
  out.push(
    `The Guardian approves a payment only up to ${r.maxRisk} risk. Use the pay tool (or POST /cosign then AgentVault.executeBatch): it checks, pays the Guardian fee and executes in one step.`,
  );
  return out;
}
