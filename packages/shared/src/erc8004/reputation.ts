// The owner's verdict on a Guardian check, as ERC-8004 feedback on the official ReputationRegistry (Fuji).
// One feedback per check the owner reviews: value 100 when the Guardian was right, 0 when it raised a false
// alarm; tag1 "tx-risk" groups the Guardian's checks, tag2 says which; feedbackHash is the checkId, so anyone can
// match a feedback to the check and its x402 payment. The Guardian's own key never writes feedback (the registry
// refuses self-feedback), so the track record comes only from the owners who used it.
import type { Hex } from "viem";

export const REPUTATION_TAG = "tx-risk";
export type FeedbackKind = "correct" | "false-positive";

/** Arguments of ReputationRegistry.giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash). */
export function guardianFeedbackArgs(agentId: number, checkId: Hex, kind: FeedbackKind, endpoint: string) {
  return [
    BigInt(agentId),
    kind === "correct" ? 100n : 0n,
    0,
    REPUTATION_TAG,
    kind,
    endpoint,
    "",
    checkId,
  ] as const;
}

/** getSummary's (count, value, decimals) as a share of checks the owners called right, 0–100, or null. */
export function reputationScore(count: bigint, value: bigint, decimals: number): number | null {
  if (count === 0n) return null;
  return Number(value) / 10 ** decimals;
}
