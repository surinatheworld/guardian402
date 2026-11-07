// Public configuration (NEXT_PUBLIC_* only; inlined at build time, so each variable is read by its full name).
import { FUJI_RPC_URL, getAddresses, parseNetwork, USDC_FUJI } from "@guardian402/shared";

export const NETWORK = parseNetwork(process.env.NEXT_PUBLIC_NETWORK || "fuji");
export const deployment = getAddresses(NETWORK);
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || (NETWORK === "fuji" ? FUJI_RPC_URL : "http://127.0.0.1:8545");
export const GUARDIAN_URL = (process.env.NEXT_PUBLIC_GUARDIAN_URL || "http://127.0.0.1:4402").replace(
  /\/$/,
  "",
);
export const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL || "http://127.0.0.1:4403").replace(/\/$/, "");

export type TokenMeta = { symbol: string; decimals: number };
const tokens: Record<string, TokenMeta> = {
  [deployment.usdc.toLowerCase()]: { symbol: USDC_FUJI.symbol, decimals: USDC_FUJI.decimals },
  [deployment.mWAVAX.toLowerCase()]: { symbol: "mWAVAX", decimals: 18 },
};
export const tokenMeta = (address: string): TokenMeta =>
  tokens[address.toLowerCase()] ?? { symbol: "token", decimals: 18 };

const names: Record<string, string> = {
  [deployment.vault.toLowerCase()]: "AgentVault",
  [deployment.router.toLowerCase()]: "MockRouter",
  [deployment.oracle.toLowerCase()]: "MockOracle",
  [deployment.usdc.toLowerCase()]: "USDC",
  [deployment.mWAVAX.toLowerCase()]: "mWAVAX",
};
export const knownName = (address: string): string | undefined => names[address.toLowerCase()];
