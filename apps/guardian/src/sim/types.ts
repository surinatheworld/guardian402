import type { Address, Hex } from "viem";
import type { Call } from "@guardian402/shared";

export type TokenDelta = {
  token: Address;
  symbol: string;
  decimals: number;
  before: bigint;
  after: bigint;
  delta: bigint;
};

export type ApprovalEvent = {
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
  unlimited: boolean;
};
export type ApprovalForAllEvent = { token: Address; owner: Address; operator: Address; approved: boolean };
export type TransferEvent = {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  /** Index of the call whose receipt holds the log (absent in fixtures captured before it existed). */
  callIndex?: number;
};

/**
 * What one simulation shows (docs/SPEC.md §7). Rules read only this and the vault policy, never the chain.
 * Amounts are raw token units; nativeDelta excludes gas.
 */
export type SimResult = {
  vault: Address;
  calls: Call[];
  success: boolean;
  timedOut: boolean;
  /**
   * Set when the simulation could not run at all: a fork or RPC error, or a timeout (waiting for the fork or
   * running on it). That is the Guardian's failure, not a property of the batch, so the pipeline refuses to
   * score or sign it and the caller is not charged. The text is internal (it can hold RPC URLs): logs only.
   */
  unavailable?: string;
  /** Decoded with the known ABIs when possible, else the raw revert data. Untrusted text: never shown to the LLM. */
  revertReason?: string;
  revertData?: Hex;
  failedCallIndex?: number;
  gasUsed: bigint;
  forkBlock: bigint;
  tokenDeltas: TokenDelta[];
  nativeBefore: bigint;
  nativeAfter: bigint;
  nativeDelta: bigint;
  approvals: ApprovalEvent[];
  approvalsForAll: ApprovalForAllEvent[];
  transfers: TransferEvent[];
  durationMs: number;
};
