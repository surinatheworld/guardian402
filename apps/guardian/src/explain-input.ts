// Builds the explainer's input from trusted data only: the normalized diff, the findings and our own labels.
import type { Finding, RiskLevel } from "@guardian402/shared";
import { toDiff } from "./diff.ts";
import type { ExplainInput } from "./explain/types.ts";
import type { Context } from "./rules/types.ts";
import type { SimResult } from "./sim/types.ts";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function explainInput(
  sim: SimResult,
  findings: Finding[],
  risk: RiskLevel,
  ctx: Context,
): ExplainInput {
  // A token's symbol() is its deployer's text, and any token can call itself "USDC". The explanation uses the
  // symbol only of tokens we already trust: the known-contracts registry and the tokens the owner tracks in the
  // vault policy. Every other token is named by its address (SPEC §9: no agent-supplied text).
  const trusted = new Set([
    ...Object.keys(ctx.knownContracts).map((a) => a.toLowerCase()),
    ...ctx.policy.tokens.map((t) => t.token.toLowerCase()),
  ]);
  const tokens: ExplainInput["tokens"] = {};
  for (const t of sim.tokenDeltas) {
    const key = t.token.toLowerCase();
    tokens[key] = { symbol: trusted.has(key) ? t.symbol : `token ${short(t.token)}`, decimals: t.decimals };
  }
  const names: ExplainInput["names"] = { [ctx.vault.toLowerCase()]: "AgentVault" };
  for (const [addr, c] of Object.entries(ctx.knownContracts)) names[addr.toLowerCase()] = c.name;
  // Copies: the explainer must not be able to edit the findings the pipeline reports and stores.
  const copy = findings.map((f) => ({ ...f, evidence: { ...f.evidence } }));
  return { risk, findings: copy, diff: toDiff(sim), tokens, names };
}
