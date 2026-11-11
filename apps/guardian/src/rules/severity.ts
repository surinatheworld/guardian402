import type { RuleId } from "@guardian402/shared";

/** Severities as listed in docs/SPEC.md §8 (for GET /v1/rules). */
export const RULE_SEVERITY: Record<RuleId, string> = {
  SIMULATION_FAILED: "HIGH",
  POLICY_PRECHECK: "HIGH",
  UNLIMITED_APPROVAL: "HIGH",
  UNKNOWN_CONTRACT: "MEDIUM; HIGH when the vault approves or sends value to it",
  ADDRESS_POISONING: "HIGH",
  DRAIN_PATTERN: "HIGH",
  ABNORMAL_SLIPPAGE: "MEDIUM ≥ 2%, HIGH ≥ 10%",
  RECIPIENT_NOT_ALLOWLISTED: "HIGH",
  UNPROTECTED_SWAP: "MEDIUM: minOut more than 3% below the simulated output",
};
