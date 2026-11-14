import type { Address, Hex } from "viem";
import { avalancheFuji } from "viem/chains";

// Network (docs/SPEC.md §2). Fuji only.
export const FUJI_CHAIN_ID = 43113 as const;
export const FUJI_CAIP2 = "eip155:43113" as const;
export const fujiChain = avalancheFuji;
export const FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";
export const SNOWTRACE_URL = "https://testnet.snowtrace.io";
export const DEFAULT_FACILITATOR_URL = "https://facilitator.ultravioletadao.xyz";

/** Circle's USDC on Fuji. Not a default x402 asset, so prices name it explicitly (SPEC §6.4). */
export const USDC_FUJI = {
  address: "0x5425890298aed601595a70AB815c96711a31Bc65",
  symbol: "USDC",
  decimals: 6,
  eip712Name: "USD Coin",
  eip712Version: "2",
} as const;

/** x402 prices in atomic USDC units (SPEC §6.1). */
export const PRICES = {
  check: "5000", // 0.005 USDC
  cosign: "10000", // 0.01 USDC
} as const;

export const MAX_CALLS = 8;
export const VERDICT_TTL_SECONDS = 60;

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type RiskCode = 0 | 1 | 2;
export const RISK_CODE = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const satisfies Record<RiskLevel, RiskCode>;

export function riskFromCode(code: RiskCode): RiskLevel {
  return RISK_LEVELS[code];
}

/** The seven risk rules plus the two system checks of SPEC §8 (nine since 2026-11-11: UNPROTECTED_SWAP). */
export const RULE_IDS = [
  "SIMULATION_FAILED",
  "POLICY_PRECHECK",
  "UNLIMITED_APPROVAL",
  "UNKNOWN_CONTRACT",
  "ADDRESS_POISONING",
  "DRAIN_PATTERN",
  "ABNORMAL_SLIPPAGE",
  "RECIPIENT_NOT_ALLOWLISTED",
  "UNPROTECTED_SWAP",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const txUrl = (hash: Hex) => `${SNOWTRACE_URL}/tx/${hash}`;
export const addressUrl = (address: Address) => `${SNOWTRACE_URL}/address/${address}`;
