import type { Address, Hex } from "viem";
import type { Finding } from "@guardian402/shared";

/** One tracked token of the vault policy, as returned by AgentVault.getPolicy(). Raw token units. */
export type TokenPolicySnapshot = {
  token: Address;
  dailyCap: bigint;
  maxApproval: bigint;
  verdictThreshold: bigint;
  spentToday: bigint;
  balance: bigint;
};

/** AgentVault.getPolicy() read before the check (docs/SPEC.md §4.4). */
export type PolicySnapshot = {
  owner: Address;
  agent: Address;
  guardian: Address;
  paused: boolean;
  verdictNonce: bigint;
  maxAgentRisk: number;
  day: bigint;
  tokens: TokenPolicySnapshot[];
  nativeDailyCap: bigint;
  nativeVerdictThreshold: bigint;
  nativeSpentToday: bigint;
  nativeBalance: bigint;
  targets: { target: Address; selectors: Hex[] }[];
  recipients: Address[];
};

export type KnownContract = {
  name: string;
  kind: "token" | "router" | "oracle" | "vault" | "registry" | "other";
};

/** Reference price for ABNORMAL_SLIPPAGE: `price` units of `quote` per 1 whole `base` (MockOracle). */
export type OracleReference = {
  base: Address;
  baseDecimals: number;
  quote: Address;
  price: bigint;
};

/** Optional explorer facts about a contract (flagged lookup, never in tests or eval). */
export type ExplorerInfo = { verified: boolean; ageDays?: number };

/**
 * Everything a rule may read besides the simulation. Built by the pipeline before the rules run; rules never
 * call the chain or the network. Address keys are lowercase.
 */
export type Context = {
  vault: Address;
  policy: PolicySnapshot;
  /** Known-contracts registry (docs/SPEC.md §8). */
  knownContracts: Record<string, KnownContract>;
  /** Extra address-book entries, e.g. addresses the vault has paid before (from the Guardian DB). */
  addressBook: Address[];
  /** Addresses that had code on the fork when the check ran (call targets and approval spenders). */
  contracts: Address[];
  oracle?: OracleReference;
  explorer?: Record<string, ExplorerInfo>;
  demoMode: boolean;
};

export type RuleConfig = {
  weights: { HIGH: number; MEDIUM: number };
  unlimitedApproval: { threshold: bigint };
  addressPoisoning: { prefix: number; suffix: number; demoPrefix: number; demoSuffix: number };
  drainPattern: { percent: number };
  abnormalSlippage: { mediumBps: number; highBps: number };
  unprotectedSwap: { maxGapBps: number };
  explorerLookup: { enabled: boolean; timeoutMs: number; cacheTtlMs: number; newContractDays: number };
};

export type { Finding };
