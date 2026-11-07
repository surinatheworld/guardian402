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
export type TransferEvent = { token: Address; from: Address; to: Address; amount: bigint };

/**
 * What one simulation shows (docs/SPEC.md §7). Rules read only this and the vault policy, never the chain.
 * Amounts are raw token units; nativeDelta excludes gas.
 */
export type SimResult = {
  vault: Address;
  calls: Call[];
  success: boolean;
  timedOut: boolean;
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
