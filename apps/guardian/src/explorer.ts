// Optional explorer facts for UNKNOWN_CONTRACT (docs/SPEC.md §8): is a contract the vault is about to call or
// approve verified on the Avalanche explorer, and how old is it? Read from Routescan, the explorer behind
// testnet.snowtrace.io, through its Etherscan-compatible API (`getsourcecode`, `getcontractcreation`), and the
// creation block's time from the chain. Behind a flag (EXPLORER_LOOKUP), cached, with a short timeout; never used
// in tests or the eval, so their results stay deterministic. A lookup that fails or times out gives no facts:
// the rule then says what it said before, it never blocks a check.
import type { Address, Hex, PublicClient } from "viem";
import type { ExplorerInfo } from "./rules/types.ts";

/** Fuji (chain 43113) on Routescan, the API behind testnet.snowtrace.io. */
export const ROUTESCAN_FUJI_API = "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api";

export type ExplorerLookup = (addresses: readonly Address[]) => Promise<Record<string, ExplorerInfo>>;

type Deps = {
  /** Reads the creation transaction's block time. */
  chain: Pick<PublicClient, "getTransaction" | "getBlock">;
  timeoutMs: number;
  cacheTtlMs: number;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

type Row = { SourceCode?: unknown; ABI?: unknown };
type Creation = { txHash?: unknown };

export function createExplorerLookup(d: Deps): ExplorerLookup {
  const base = d.baseUrl ?? ROUTESCAN_FUJI_API;
  const get = d.fetch ?? fetch;
  const now = d.now ?? Date.now;
  const cache = new Map<string, { at: number; info: ExplorerInfo }>();

  async function api<T>(query: string, signal: AbortSignal): Promise<T[] | null> {
    const res = await get(`${base}?${query}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: unknown; result?: unknown };
    return body.status === "1" && Array.isArray(body.result) ? (body.result as T[]) : null;
  }

  async function one(address: Address, signal: AbortSignal): Promise<ExplorerInfo | null> {
    const [source, creation] = await Promise.all([
      api<Row>(`module=contract&action=getsourcecode&address=${address}`, signal),
      api<Creation>(`module=contract&action=getcontractcreation&contractaddresses=${address}`, signal),
    ]);
    if (!source) return null;
    const code = source[0]?.SourceCode;
    const verified = typeof code === "string" && code.length > 0;
    const info: ExplorerInfo = { verified };
    const tx = creation?.[0]?.txHash;
    if (typeof tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(tx)) {
      const t = await d.chain.getTransaction({ hash: tx as Hex });
      if (t.blockNumber !== null) {
        const block = await d.chain.getBlock({ blockNumber: t.blockNumber });
        info.ageDays = Math.max(0, Math.floor((now() / 1000 - Number(block.timestamp)) / 86_400));
      }
    }
    return info;
  }

  return async (addresses) => {
    const out: Record<string, ExplorerInfo> = {};
    const todo: Address[] = [];
    for (const a of new Set(addresses.map((x) => x.toLowerCase() as Address))) {
      const hit = cache.get(a);
      if (hit && now() - hit.at < d.cacheTtlMs) out[a] = hit.info;
      else todo.push(a);
    }
    if (todo.length === 0) return out;
    const signal = AbortSignal.timeout(d.timeoutMs);
    // The whole lookup (explorer and chain reads) gets the same budget.
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), d.timeoutMs).unref?.());
    const results = await Promise.all(
      todo.map((a) => Promise.race([one(a, signal).catch(() => null), late])),
    );
    todo.forEach((a, i) => {
      const info = results[i];
      if (!info) return;
      cache.set(a, { at: now(), info });
      out[a] = info;
    });
    return out;
  };
}
