// Same-origin RPC proxy for a browser on another machine (public tunnel) in `local` mode: it forwards reads to
// the Anvil fork on this host. The fork also answers Anvil's admin methods (anvil_setCode, anvil_reset,
// evm_setAutomine, …), and the Guardian simulates on that fork, so the proxy passes only the methods below
// (docs/THREAT_MODEL.md, P16 finding D1). Everything else is refused here and never reaches the fork.

/** Chain reads, plus signed raw transactions (they carry their own signature, as on any public RPC). */
export const RPC_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
]);

export const RPC_MAX_BODY_BYTES = 128 * 1024;
export const RPC_MAX_BATCH = 50;

export type RpcProxyDeps = {
  /** False outside `local`: Fuji has its own public RPC, so there is nothing to proxy. */
  enabled: boolean;
  /** The fork, e.g. http://127.0.0.1:8545. */
  upstream: string;
  fetch?: typeof fetch;
};

type RpcId = string | number | null;
type RpcResponse = { jsonrpc: "2.0"; id: RpcId; result?: unknown; error?: { code: number; message: string } };

const rpcError = (id: RpcId, code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const idOf = (req: unknown): RpcId => {
  const id = (req as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
};

async function one(req: unknown, d: RpcProxyDeps): Promise<RpcResponse> {
  const id = idOf(req);
  const r = req as { jsonrpc?: unknown; method?: unknown; params?: unknown } | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.method !== "string")
    return rpcError(id, -32600, "invalid request");
  if (!RPC_ALLOWED_METHODS.has(r.method)) return rpcError(id, -32601, "method not allowed by this proxy");
  if (r.params !== undefined && !Array.isArray(r.params)) return rpcError(id, -32602, "invalid params");
  try {
    const res = await (d.fetch ?? fetch)(d.upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Rebuilt, not passed through: only these four fields ever reach the fork.
      body: JSON.stringify({ jsonrpc: "2.0", id, method: r.method, params: r.params ?? [] }),
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown } };
    if (body.error)
      return rpcError(
        id,
        typeof body.error.code === "number" ? body.error.code : -32603,
        typeof body.error.message === "string" ? body.error.message : "rpc error",
      );
    return { jsonrpc: "2.0", id, result: body.result ?? null };
  } catch {
    // The cause can hold the upstream URL: not for callers.
    return rpcError(id, -32603, "fork unavailable");
  }
}

/** `raw` is the request body as text. Returns the HTTP status and the JSON-RPC body. */
export async function proxyRpc(raw: string, d: RpcProxyDeps): Promise<{ status: number; body: unknown }> {
  if (!d.enabled) return { status: 404, body: { error: "not found" } };
  if (Buffer.byteLength(raw) > RPC_MAX_BODY_BYTES)
    return { status: 413, body: { error: "request too large" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: rpcError(null, -32700, "parse error") };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.length > RPC_MAX_BATCH)
      return { status: 400, body: rpcError(null, -32600, "invalid batch") };
    return { status: 200, body: await Promise.all(parsed.map((req) => one(req, d))) };
  }
  return { status: 200, body: await one(parsed, d) };
}
