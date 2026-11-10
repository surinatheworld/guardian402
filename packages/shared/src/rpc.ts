// RPC transport with fallback (P14). The public Fuji RPC rate-limits (HTTP 429, Cloudflare 1015); with a
// fallback, a read or a broadcast that fails on one endpoint is retried on the next, so a demo does not stop on
// one provider's limit. A local node (the Anvil fork) gets a plain transport: there is nothing to fall back to.
import { fallback, http, type Transport } from "viem";
import { FUJI_RPC_URL } from "./constants.ts";

/** Second public Fuji endpoint (Allnodes PublicNode), measured about twice as fast as the official one. */
export const FUJI_RPC_FALLBACK_URL = "https://avalanche-fuji-c-chain-rpc.publicnode.com";

const isLocal = (url: string) => /^\/|^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url);

/** `primary` first, then the other public Fuji endpoints; just `primary` for a local node. */
export function rpcUrls(primary: string): string[] {
  if (isLocal(primary)) return [primary];
  return [...new Set([primary, FUJI_RPC_URL, FUJI_RPC_FALLBACK_URL])];
}

/** A viem transport for `primary`, falling back to the other public Fuji endpoints when it is remote. */
export function rpcTransport(primary: string): Transport {
  const urls = rpcUrls(primary);
  if (urls.length === 1) return http(primary);
  return fallback(
    urls.map((u) => http(u, { retryCount: 1 })),
    { rank: false, retryCount: 1 },
  );
}
