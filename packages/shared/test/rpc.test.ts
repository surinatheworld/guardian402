// The public Fuji RPC answers a rate limit with HTTP 429 and `Retry-After: 2990` (seen 2026-11-11, Cloudflare
// 1015). viem's http transport waits Retry-After before it retries, so the fallback must not retry an endpoint
// itself: it has to move to the next one at once.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient } from "viem";
import { fujiChain } from "../src/index.ts";
import { fallbackTransport } from "../src/rpc.ts";

const servers: Server[] = [];
const hits = { limited: 0, healthy: 0 };

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let limited = "";
let healthy = "";

beforeAll(async () => {
  limited = await serve((_req, res) => {
    hits.limited++;
    res.writeHead(429, { "retry-after": "2990", "content-type": "text/html" });
    res.end("<html>Access denied | rate limited</html>");
  });
  healthy = await serve((req, res) => {
    hits.healthy++;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body) as { id: number };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0xa869" }));
    });
  });
});
afterAll(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

describe("fallbackTransport", () => {
  it("moves past a rate-limited endpoint at once instead of waiting Retry-After", async () => {
    const client = createPublicClient({ chain: fujiChain, transport: fallbackTransport([limited, healthy]) });
    const started = Date.now();
    expect(await client.getChainId()).toBe(43113);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hits.limited).toBe(1); // asked once, not retried
    expect(hits.healthy).toBe(1);
  });

  it("fails fast when every endpoint is rate-limited", async () => {
    const client = createPublicClient({ chain: fujiChain, transport: fallbackTransport([limited, limited]) });
    const started = Date.now();
    await expect(client.getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
