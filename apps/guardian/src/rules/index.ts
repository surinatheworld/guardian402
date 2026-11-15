// Rule engine (docs/SPEC.md §8): pure functions over a simulation and a context snapshot.
import { RULE_IDS, type RuleId } from "@guardian402/shared";
import type { SimResult } from "../sim/types.ts";
import { RULES } from "./checks.ts";
import { defaultRuleConfig } from "./config.ts";
import type { Context, Finding, RuleConfig } from "./types.ts";

export { aggregate, type Aggregate } from "./aggregate.ts";
export { defaultRuleConfig, parseRuleConfig } from "./config.ts";
export { RULES, type Rule } from "./checks.ts";
export { loadKnownContracts } from "./known-contracts.ts";
export type * from "./types.ts";

/**
 * The rules for a wallet check (any wallet, no AgentVault): every rule except the two that read a vault policy
 * (POLICY_PRECHECK, RECIPIENT_NOT_ALLOWLISTED). They cover the five checks of topic 14: unlimited approval,
 * unknown or unverified contract, address poisoning, drain pattern, abnormal slippage.
 */
export const WALLET_RULE_IDS: readonly RuleId[] = RULE_IDS.filter(
  (id) => id !== "POLICY_PRECHECK" && id !== "RECIPIENT_NOT_ALLOWLISTED",
);

/** Runs the rules in the fixed order of RULE_IDS (all of them by default). A rule that throws is a bug. */
export function runRules(
  sim: SimResult,
  ctx: Context,
  cfg: RuleConfig = defaultRuleConfig,
  ids: readonly RuleId[] = RULE_IDS,
): Finding[] {
  return ids.flatMap((id) => RULES[id](sim, ctx, cfg));
}
