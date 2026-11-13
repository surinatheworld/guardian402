// Public configuration (NEXT_PUBLIC_* only; inlined at build time, so each variable is read by its full name).
import { FUJI_RPC_URL, getAddresses, parseNetwork, USDC_FUJI } from "@guardian402/shared";
import { getAddress, isAddress } from "viem";

export const NETWORK = parseNetwork(process.env.NEXT_PUBLIC_NETWORK || "fuji");
const configuredVault = process.env.NEXT_PUBLIC_DEMO_VAULT;
if (configuredVault && (NETWORK !== "local" || !isAddress(configuredVault))) {
  throw new Error("NEXT_PUBLIC_DEMO_VAULT requires a valid address and NEXT_PUBLIC_NETWORK=local");
}
export const deployment = {
  ...getAddresses(NETWORK),
  ...(configuredVault ? { vault: getAddress(configuredVault) } : {}),
};
// Public endpoint: leave NEXT_PUBLIC_{RPC,GUARDIAN,AGENT}_URL empty and a browser on another machine (public
// tunnel) uses the same-origin proxy of next.config.ts, while the host's own browser keeps 127.0.0.1. Set them
// only when a service has its own public URL.
const isRemoteBrowser =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

// Fuji's public RPC answers any browser; only the fork (`local`) needs the proxy.
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  (NETWORK === "fuji" ? FUJI_RPC_URL : isRemoteBrowser ? "/api/rpc" : "http://127.0.0.1:8545");

export const GUARDIAN_URL = (
  process.env.NEXT_PUBLIC_GUARDIAN_URL || (isRemoteBrowser ? "/api/guardian" : "http://127.0.0.1:4402")
).replace(/\/$/, "");

export const AGENT_URL = (
  process.env.NEXT_PUBLIC_AGENT_URL || (isRemoteBrowser ? "/api/agent-control" : "http://127.0.0.1:4403")
).replace(/\/$/, "");

/**
 * `NEXT_PUBLIC_AGENT_CONTROL=off`: this deployment runs no agent control API (a hosted dashboard whose Guardian
 * does not sign for the demo vault). The dashboard then never calls it, and the trial page only simulates.
 */
export const AGENT_CONTROL_ENABLED = process.env.NEXT_PUBLIC_AGENT_CONTROL !== "off";

/**
 * `NEXT_PUBLIC_MCP_PACKAGE`: the published agent MCP package (e.g. `guardian402-mcp@0.1.0`, packages/mcp-agent). When
 * set, the connect section shows `npx -y <package>` (no source checkout needed); empty: the pnpm command in a clone.
 */
export const MCP_PACKAGE = process.env.NEXT_PUBLIC_MCP_PACKAGE?.trim() ?? "";

export type TokenMeta = { symbol: string; decimals: number };
const tokens: Record<string, TokenMeta> = {
  [deployment.usdc.toLowerCase()]: { symbol: USDC_FUJI.symbol, decimals: USDC_FUJI.decimals },
  [deployment.mWAVAX.toLowerCase()]: { symbol: "mWAVAX", decimals: 18 },
};
export const tokenMeta = (address: string): TokenMeta =>
  tokens[address.toLowerCase()] ?? { symbol: "token", decimals: 18 };

// Names the owner reads next to an address. The DEMO contracts carry their role, not their class name.
const names: Record<string, string> = {
  [deployment.vault.toLowerCase()]: "Két demo",
  [deployment.router.toLowerCase()]: "Sàn swap thử nghiệm",
  [deployment.oracle.toLowerCase()]: "Bảng giá thử nghiệm",
  [deployment.usdc.toLowerCase()]: "USDC",
  [deployment.mWAVAX.toLowerCase()]: "WAVAX thử nghiệm",
  [deployment.deployer.toLowerCase()]: "Treasury",
};
export const knownName = (address: string): string | undefined => names[address.toLowerCase()];
