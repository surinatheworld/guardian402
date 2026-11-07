// Rule engine (docs/SPEC.md §8): pure functions over a simulation and a context snapshot.
import { RULE_IDS } from "@guardian402/shared";
import type { SimResult } from "../sim/types.ts";
import { RULES } from "./checks.ts";
import { defaultRuleConfig } from "./config.ts";
import type { Context, Finding, RuleConfig } from "./types.ts";

export { aggregate, type Aggregate } from "./aggregate.ts";
export { defaultRuleConfig, parseRuleConfig } from "./config.ts";
export { RULES, type Rule } from "./checks.ts";
export { loadKnownContracts } from "./known-contracts.ts";
export type * from "./types.ts";

/** Runs every rule in the fixed order of RULE_IDS. A rule that throws is a bug: let it surface. */
export function runRules(sim: SimResult, ctx: Context, cfg: RuleConfig = defaultRuleConfig): Finding[] {
  return RULE_IDS.flatMap((id) => RULES[id](sim, ctx, cfg));
}
