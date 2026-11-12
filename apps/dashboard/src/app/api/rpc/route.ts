// POST /api/rpc: read-only JSON-RPC proxy to the Anvil fork, `local` mode only (src/server/rpc-proxy.ts).
import { NETWORK } from "@/lib/config";
import { proxyRpc } from "@/server/rpc-proxy";

export async function POST(req: Request) {
  const { status, body } = await proxyRpc(await req.text(), {
    enabled: NETWORK === "local",
    upstream: process.env.FORK_PROXY_URL || "http://127.0.0.1:8545",
  });
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
