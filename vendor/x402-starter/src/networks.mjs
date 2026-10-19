// The two Avalanche networks this starter knows, and what the three programs share.
import { formatUnits, isAddress, parseUnits } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";

// id is the CAIP-2 name x402 uses for a network: "eip155:" and the chain id.
// usdc is Circle's own USDC contract on that network.
const NETWORKS = {
  fuji: { name: "Avalanche Fuji", id: "eip155:43113", chain: avalancheFuji, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", explorer: "https://testnet.snowtrace.io" },
  mainnet: { name: "Avalanche C-Chain", id: "eip155:43114", chain: avalanche, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", explorer: "https://snowtrace.io" },
};

const key = (process.env.NETWORK || "fuji").toLowerCase();
if (!NETWORKS[key]) stop(`NETWORK is "${key}". Use fuji or mainnet.`);

export const NET = { key, ...NETWORKS[key], rpc: process.env.RPC_URL || NETWORKS[key].chain.rpcUrls.default.http[0] };
export const FACILITATOR_URL = (process.env.FACILITATOR_URL || "https://facilitator.ultravioletadao.xyz").replace(/\/+$/, "");

// USDC has 6 decimals, so 0.001 USDC travels as the whole number 1000.
export const toUnits = (usdc) => parseUnits(String(usdc), 6).toString();
export const fromUnits = (units) => formatUnits(BigInt(units), 6);

// What the seller asks for: an exact amount of USDC on the chosen network.
// Why name and version? The buyer does not send a transaction. They sign a typed message (EIP-712), and USDC
// only accepts it when the message names the contract the way the contract names itself: name() and version().
// The x402 library knows these for C-Chain mainnet but not for Fuji, so this starter states them for both.
export const price = (usdc) => ({ amount: toUnits(usdc), asset: NET.usdc, extra: { name: "USD Coin", version: "2" } });

export const txLink = (hash) => `${NET.explorer}/tx/${hash}`;

export function address(name) {
  const value = process.env[name] || "";
  if (!isAddress(value)) stop(`Set ${name} in .env.local to a wallet address (0x and 40 hex characters).`);
  return value;
}

export function privateKey(name, hint) {
  const value = process.env[name] || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) stop(`Set ${name} in .env.local. ${hint}`);
  return value;
}

export function stop(message) {
  console.error(message);
  process.exit(1);
}
