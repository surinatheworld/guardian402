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
/**
 * viem `fallback` over `urls`: one attempt per endpoint, in order. No retries: viem's http transport waits the
 * server's `Retry-After` before retrying, and the public Fuji RPC sends `Retry-After: 2990` with its 429, so a
 * retry (on one endpoint, or of the whole list) would stall the caller for about 50 minutes instead of failing
 * over. An `http(url, { retryCount })` would also override the zero that `fallback` passes to each endpoint.
 */
export function fallbackTransport(urls: string[]): Transport {
  return fallback(
    urls.map((u) => http(u)),
    { rank: false, retryCount: 0 },
  );
}

export function rpcTransport(primary: string): Transport {
  const urls = rpcUrls(primary);
  if (urls.length === 1) return http(primary);
  return fallbackTransport(urls);
}
