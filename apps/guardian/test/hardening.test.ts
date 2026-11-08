// P13 hardening of the Guardian API (docs/THREAT_MODEL.md, F6 and F7): Host check, busy gate before the
// paywall, no internal error text in responses. Also the mutex's queue count behind the busy gate.
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddresses } from "@guardian402/shared";
import { createApp, type AppDeps } from "../src/app.ts";
import { TemplateExplainer } from "../src/explain/index.ts";
import { Pipeline } from "../src/pipeline.ts";
import { defaultRuleConfig, loadKnownContracts } from "../src/rules/index.ts";
import { createSigner } from "../src/sign/index.ts";
import { Mutex } from "../src/sim/mutex.ts";
import { Store } from "../src/store.ts";

const deployment = getAddresses("local");
const SECRET = "https://rpc.example/key-abc123 refused";
const body = JSON.stringify({
  chainId: 43113,
  vault: deployment.vault,
  calls: [{ target: deployment.router, value: "0", data: "0x" }],
});

let store: Store;
const servers: Server[] = [];

/** An app whose chain read fails with a message that must never reach the caller. */
async function start(extra: Partial<AppDeps>): Promise<number> {
  const chain = {
    readContract: async () => {
      throw new Error(SECRET);
    },
    getBlock: async () => ({ timestamp: 0n }),
    getCode: async () => undefined,
  } as unknown as PublicClient;
  const signer = createSigner(generatePrivateKey());
  const pipeline = new Pipeline({
    chain,
    simulator: { simulate: async () => Promise.reject(new Error(SECRET)) },
    explainer: new TemplateExplainer(),
    signer,
    store,
    deployment,
    knownContracts: loadKnownContracts("local"),
    demoMode: true,
    policyCacheMs: 0,
  });
  const app = createApp({
    pipeline,
    store,
    ruleConfig: defaultRuleConfig,
    deployment,
    signerAddress: signer.address,
    payTo: deployment.deployer,
    demoMode: true,
    dashboardOrigin: "http://localhost:3000",
    resourceServer: null,
    forkBlock: async () => 1n,
    ...extra,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

function call(port: number, method: string, path: string, host: string, payload?: string) {
  return new Promise<{ status: number; text: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, method, path, headers: { host, "content-type": "application/json" } },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    },
  );
}

beforeAll(() => {
  store = new Store(":memory:");
});
afterAll(() => {
  for (const s of servers) s.close();
  store.close();
});

describe("Guardian API hardening (P13)", () => {
  it("a failed check answers 502 without the internal error text", async () => {
    const port = await start({});
    const r = await call(port, "POST", "/v1/check", `127.0.0.1:${port}`, body);
    expect(r.status).toBe(502);
    expect(r.text).not.toContain("rpc.example");
    expect(JSON.parse(r.text)).toEqual({ error: "check failed" });
  });

  it("a busy Guardian refuses new checks with 503 before the paywall", async () => {
    const port = await start({ busy: () => true });
    for (const path of ["/v1/check", "/v1/cosign", "/v1/demo/check"]) {
      const r = await call(port, "POST", path, `127.0.0.1:${port}`, body);
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBe("5");
    }
    const health = await call(port, "GET", "/v1/health", `127.0.0.1:${port}`);
    expect(health.status).toBe(200);
  });

  it("refuses a Host it does not serve (DNS rebinding)", async () => {
    const port = await start({ allowedHosts: new Set(["placeholder"]) });
    const r = await call(port, "GET", "/v1/health", `evil.example:${port}`);
    expect(r.status).toBe(403);
  });

  it("serves its own Host", async () => {
    const probe = await start({});
    const allowed = new Set([`127.0.0.1:${probe + 1}`]);
    const port = await start({ allowedHosts: allowed });
    allowed.add(`127.0.0.1:${port}`);
    const r = await call(port, "GET", "/v1/health", `127.0.0.1:${port}`);
    expect(r.status).toBe(200);
  });
});

describe("Mutex queue count", () => {
  it("counts running and waiting tasks, and drops them as they settle", async () => {
    const m = new Mutex();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = m.run(() => gate);
    const b = m.run(async () => "b");
    const c = m.run(async () => Promise.reject(new Error("c")));
    expect(m.size).toBe(3);
    release();
    await a;
    expect(await b).toBe("b");
    await expect(c).rejects.toThrow("c");
    await new Promise((r) => setTimeout(r, 0));
    expect(m.size).toBe(0);
  });
});
