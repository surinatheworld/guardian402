// The two same-origin proxies a public tunnel exposes: /api/rpc (fork, reads only) and /api/agent-control,
// and how the account routes see a request that came through such a tunnel (origin, client, limits).
import { describe, expect, it } from "vitest";
import { AccountError } from "../src/server/accounts";
import { classifyControl, forwardControl } from "../src/server/agent-control";
import {
  assertSameOrigin,
  clientKey,
  limitLogin,
  limitRegister,
  RateLimiter,
  requestOrigin,
} from "../src/server/http";
import { proxyRpc, RPC_MAX_BATCH, RPC_MAX_BODY_BYTES } from "../src/server/rpc-proxy";

type Sent = { url: string; init: RequestInit };

function fakeFetch(answer: (body: { method?: string }) => unknown = () => ({ result: "0x1" })) {
  const sent: Sent[] = [];
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as { method?: string }) : {};
    return new Response(JSON.stringify(answer(body)), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, sent };
}

const rpc = (body: unknown, f: typeof fetch, enabled = true) =>
  proxyRpc(typeof body === "string" ? body : JSON.stringify(body), {
    enabled,
    upstream: "http://fork.test",
    fetch: f,
  });

describe("/api/rpc", () => {
  it("forwards a read and returns its result", async () => {
    const { f, sent } = fakeFetch();
    const out = await rpc({ jsonrpc: "2.0", id: 7, method: "eth_blockNumber", params: [] }, f);
    expect(out).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 7, result: "0x1" } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.init.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "eth_blockNumber",
      params: [],
    });
  });

  it.each([
    "anvil_setCode",
    "anvil_setStorageAt",
    "anvil_reset",
    "anvil_impersonateAccount",
    "anvil_setBalance",
    "evm_setAutomine",
    "evm_snapshot",
    "evm_revert",
    "evm_mine",
    "hardhat_setCode",
    "eth_sendTransaction",
    "eth_sendUnsignedTransaction",
    "eth_accounts",
    "eth_sign",
    "debug_traceTransaction",
    "ETH_CALL",
  ])("refuses %s without calling the fork", async (method) => {
    const { f, sent } = fakeFetch();
    const out = await rpc({ jsonrpc: "2.0", id: 1, method, params: [] }, f);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ id: 1, error: { code: -32601 } });
    expect(sent).toHaveLength(0);
  });

  it("in a batch, forwards the reads and refuses the rest", async () => {
    const { f, sent } = fakeFetch();
    const out = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
        { jsonrpc: "2.0", id: 2, method: "anvil_reset", params: [] },
        { jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: "0x00" }, "latest"] },
      ],
      f,
    );
    expect(out.body).toMatchObject([{ id: 1, result: "0x1" }, { id: 2, error: { code: -32601 } }, { id: 3 }]);
    expect(sent.map((s) => (JSON.parse(s.init.body as string) as { method: string }).method)).toEqual([
      "eth_chainId",
      "eth_call",
    ]);
  });

  it("does not pass extra fields or non-array params to the fork", async () => {
    const { f, sent } = fakeFetch();
    await rpc({ jsonrpc: "2.0", id: 1, method: "eth_chainId", extra: "anvil_reset" }, f);
    expect(Object.keys(JSON.parse(sent[0]?.init.body as string) as object).sort()).toEqual([
      "id",
      "jsonrpc",
      "method",
      "params",
    ]);
    const bad = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: { a: 1 } }, f);
    expect(bad.body).toMatchObject({ error: { code: -32602 } });
    expect(sent).toHaveLength(1);
  });

  it("is off outside local mode", async () => {
    const { f, sent } = fakeFetch();
    const out = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, f, false);
    expect(out.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it("refuses malformed, oversized and over-long requests", async () => {
    const { f, sent } = fakeFetch();
    expect((await rpc("{", f)).status).toBe(400);
    expect((await rpc("x".repeat(RPC_MAX_BODY_BYTES + 1), f)).status).toBe(413);
    expect((await rpc([], f)).status).toBe(400);
    const many = Array.from({ length: RPC_MAX_BATCH + 1 }, (_, id) => ({ id, method: "eth_chainId" }));
    expect((await rpc(many, f)).status).toBe(400);
    expect((await rpc("null", f)).body).toMatchObject({ error: { code: -32600 } });
    expect(sent).toHaveLength(0);
  });

  it("hides the upstream when the fork is down", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED http://fork.test");
    }) as unknown as typeof fetch;
    const out = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, down);
    expect(out.body).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "fork unavailable" } });
  });
});

describe("/api/agent-control", () => {
  it("knows only health, attempts and the seven scenarios", () => {
    expect(classifyControl("GET", ["health"])).toEqual({ kind: "read", path: "health" });
    expect(classifyControl("GET", ["attempts"])).toEqual({ kind: "read", path: "attempts" });
    expect(classifyControl("POST", ["scenario", "S0"])).toEqual({ kind: "scenario", id: "S0" });
    expect(classifyControl("POST", ["scenario", "S6"])).toEqual({ kind: "scenario", id: "S6" });
    for (const [method, path] of [
      ["GET", ["scenario", "S0"]],
      ["POST", ["health"]],
      ["POST", ["scenario", "S7"]],
      ["POST", ["scenario", "s0"]],
      ["POST", ["scenario", "S0", "x"]],
      ["POST", ["scenario", "..", "health"]],
      ["DELETE", ["attempts"]],
      ["GET", []],
    ] as const)
      expect(classifyControl(method, path)).toBeNull();
  });

  it("adds the control API's headers itself and forwards nothing else", async () => {
    const { f, sent } = fakeFetch(() => ({ ok: true }));
    const d = { upstream: "http://agent.test/", origin: "http://localhost:3000", fetch: f };
    await forwardControl({ kind: "scenario", id: "S1" }, null, d);
    await forwardControl({ kind: "read", path: "attempts" }, "100", d);
    await forwardControl({ kind: "read", path: "attempts" }, "1&x=1", d);
    await forwardControl({ kind: "read", path: "health" }, "5", d);
    expect(sent.map((s) => [s.init.method, s.url])).toEqual([
      ["POST", "http://agent.test/scenario/S1"],
      ["GET", "http://agent.test/attempts?limit=100"],
      ["GET", "http://agent.test/attempts"],
      ["GET", "http://agent.test/health"],
    ]);
    expect(sent[0]?.init.headers).toEqual({ origin: "http://localhost:3000", "x-guardian402-demo": "1" });
    expect(sent[1]?.init.headers).toEqual({});
  });

  it("answers 502 when the control API is not running", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const out = await forwardControl({ kind: "read", path: "health" }, null, {
      upstream: "http://agent.test",
      origin: "http://localhost:3000",
      fetch: down,
    });
    expect(out.status).toBe(502);
  });
});

describe("request origin, client key and limits", () => {
  const req = (headers: Record<string, string> = {}, url = "http://localhost:3000/api/auth/login") =>
    new Request(url, { method: "POST", headers });

  it("uses the forwarded scheme and host behind a TLS-terminating proxy", () => {
    expect(requestOrigin(req())).toEqual({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      https: false,
    });
    const tunnel = req({ "x-forwarded-proto": "https", "x-forwarded-host": "demo.example.com" });
    expect(requestOrigin(tunnel)).toEqual({
      origin: "https://demo.example.com",
      host: "demo.example.com",
      https: true,
    });
    expect(() =>
      assertSameOrigin(req({ ...Object.fromEntries(tunnel.headers), origin: "https://demo.example.com" })),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(req({ ...Object.fromEntries(tunnel.headers), origin: "http://localhost:3000" })),
    ).toThrow(AccountError);
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).toThrow(AccountError);
    expect(() => assertSameOrigin(req())).toThrow(AccountError);
  });

  it("with DASHBOARD_PUBLIC_ORIGINS, accepts only those origins and this machine", () => {
    process.env.DASHBOARD_PUBLIC_ORIGINS = "https://demo.example.com/, https://other.example.com";
    try {
      const at = (host: string) => req({ "x-forwarded-proto": "https", "x-forwarded-host": host });
      expect(requestOrigin(at("demo.example.com")).origin).toBe("https://demo.example.com");
      expect(requestOrigin(at("other.example.com")).https).toBe(true);
      expect(() => requestOrigin(at("evil.example"))).toThrow(AccountError);
      expect(() => requestOrigin(at("demo.example.com.evil.example"))).toThrow(AccountError);
      expect(requestOrigin(req()).origin).toBe("http://localhost:3000");
    } finally {
      delete process.env.DASHBOARD_PUBLIC_ORIGINS;
    }
  });

  it("keys a client by the last X-Forwarded-For entry, the one the proxy wrote", () => {
    expect(clientKey(req())).toBe("local");
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2 , 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("wrong guesses from one client do not lock the email for another client", () => {
    const from = (ip: string) => req({ "x-forwarded-for": ip });
    const email = "owner-lockout@example.com";
    for (let i = 0; i < 10; i++) limitLogin(from("198.51.100.1"), email);
    expect(() => limitLogin(from("198.51.100.1"), email)).toThrow(AccountError);
    expect(() => limitLogin(from("198.51.100.2"), email)).not.toThrow();
  });

  it("a made-up X-Forwarded-For does not lift the registration cap", () => {
    let refused = 0;
    for (let i = 0; i < 80; i++) {
      try {
        limitRegister(req({ "x-forwarded-for": `10.0.${i}.1` }));
      } catch {
        refused++;
      }
    }
    expect(refused).toBe(20); // 60 per window for all callers together
  });

  it("past its key cap, drops the least recently used keys, not every key", () => {
    const l = new RateLimiter(2, 1000);
    for (let i = 0; i < RateLimiter.MAX_KEYS - 1; i++) l.take(`old-${i}`, 0);
    l.take("victim", 1);
    l.take("victim", 2);
    for (let i = 0; i < 50; i++) l.take(`flood-${i}`, 3); // goes over the cap 50 times
    expect(() => l.take("victim", 4)).toThrow(AccountError);
    expect(() => l.take("old-0", 4)).not.toThrow(); // dropped: counted from zero again
    expect(() => l.take("old-0", 5)).not.toThrow();
    expect(() => l.take("old-0", 6)).toThrow(AccountError);
  });
});
