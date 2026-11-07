// Builds the explainer's input from trusted data only: the normalized diff, the findings and our own labels.
import type { Finding, RiskLevel } from "@guardian402/shared";
import { toDiff } from "./diff.ts";
import type { ExplainInput } from "./explain/types.ts";
import type { Context } from "./rules/types.ts";
import type { SimResult } from "./sim/types.ts";

export function explainInput(
  sim: SimResult,
  findings: Finding[],
  risk: RiskLevel,
  ctx: Context,
): ExplainInput {
  const tokens: ExplainInput["tokens"] = {};
  for (const t of sim.tokenDeltas) tokens[t.token.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals };
  const names: ExplainInput["names"] = { [ctx.vault.toLowerCase()]: "AgentVault" };
  for (const [addr, c] of Object.entries(ctx.knownContracts)) names[addr.toLowerCase()] = c.name;
  return { risk, findings, diff: toDiff(sim), tokens, names };
}
