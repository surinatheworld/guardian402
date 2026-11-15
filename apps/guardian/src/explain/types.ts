import type { Diff, Explanation, Finding, RiskLevel } from "@guardian402/shared";

/**
 * Everything the explainer may see (docs/SPEC.md §9): the normalized diff, the findings and trusted names.
 * Never raw calldata, revert strings from untrusted contracts, or text the agent supplied.
 */
export type ExplainInput = {
  risk: RiskLevel;
  findings: Finding[];
  diff: Diff;
  /** Token metadata by lowercase address (symbol, decimals). */
  tokens: Record<string, { symbol: string; decimals: number }>;
  /** Trusted labels by lowercase address: the vault and the known-contracts registry. */
  names: Record<string, string>;
  /** Whose balances the diff is: an AgentVault (default) or any wallet checked before it signs. */
  subject?: "vault" | "wallet";
};

export interface Explainer {
  /** Writes text only. It can never change the risk level it is given. */
  explain(input: ExplainInput): Promise<Explanation>;
}

export const MAX_EXPLANATION_CHARS = 400;
