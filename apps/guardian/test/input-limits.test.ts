// Findings of the 2026-11-14 black-box test run:
//  - a vault address that is not an AgentVault answered 502 "check failed" instead of a 400 about the input;
//  - the free demo endpoint had one shared counter, so one visitor could use up the trial page for everyone;
//  - the self-hosted facilitator answered a body without its two fields with 500 and an HTML stack trace.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  ContractFunctionExecutionError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  type PublicClient,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentVaultAbi, getAddresses } from "@guardian402/shared";
import { createApp, demoRateLimit } from "../src/app.ts";
import { TemplateExplainer } from "../src/explain/index.ts";
import { createFacilitatorApp } from "../src/facilitator.ts";
import { Pipeline } from "../src/pipeline.ts";
import { defaultRuleConfig, loadKnownContracts } from "../src/rules/index.ts";
import { createSigner } from "../src/sign/index.ts";

const deployment = getAddresses("fuji");
const servers: Server[] = [];
async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterAll(() => {
  for (const s of servers) s.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

describe("a vault address that is not an AgentVault", () => {
  const NOT_A_VAULT = "0x000000000000000000000000000000000000dEaD";
  const RPC_DOWN = "0x00000000000000000000000000000000000000aa";
  let base = "";
  beforeAll(async () => {
    const chain = {
      // What viem throws when the node answers "0x" for getPolicy(): no contract, or no such function.
      readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
        if (functionName === "price") return 0n; // the oracle is fine: only the vault read fails
        if (address.toLowerCase() === RPC_DOWN.toLowerCase())
          throw new HttpRequestError({ url: "http://rpc.invalid", status: 503 });
        throw new ContractFunctionExecutionError(
          new ContractFunctionZeroDataError({ functionName: "getPolicy" }),
          {
            abi: agentVaultAbi,
            functionName: "getPolicy",
            contractAddress: address as `0x${string}`,
          },
        );
      },
    } as unknown as PublicClient;
    const pipeline = new Pipeline({
      chain,
      simulator: {
        simulate: async () => {
          throw new Error("the simulator must not run for a non-vault");
        },
      },
      explainer: new TemplateExplainer(),
      signer: createSigner(generatePrivateKey()),
      deployment,
      knownContracts: loadKnownContracts("fuji"),
      demoMode: true,
      policyCacheMs: 0,
    });
    base = await listen(
      createApp({
        pipeline,
        store: undefined as never,
        ruleConfig: defaultRuleConfig,
        deployment,
        signerAddress: deployment.deployer,
        payTo: deployment.deployer,
        demoMode: true,
        dashboardOrigin: "http://localhost:3000",
        resourceServer: null,
        forkBlock: async () => 1n,
      }),
    );
  });
  const body = (vault: string) => ({
    chainId: 43113,
    vault,
    calls: [{ target: deployment.usdc, value: "0", data: "0x" }],
  });

  it("is the caller's input: 400 that names the vault field, on every check route", async () => {
    for (const path of ["/v1/demo/check", "/v1/check", "/v1/cosign"]) {
      const res = await post(`${base}${path}`, body(NOT_A_VAULT));
      expect(res.status, path).toBe(400);
      const json = (await res.json()) as { error: string; details: { fieldErrors: { vault: string[] } } };
      expect(json.error).toBe("invalid request");
      expect(json.details.fieldErrors.vault[0]).toMatch(/not an AgentVault/);
    }
  });

  it("an RPC failure while reading the vault is still the Guardian's error (502, no internals)", async () => {
    const res = await post(`${base}/v1/demo/check`, body(RPC_DOWN));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/rpc\.invalid/);
  });
});

describe("demo endpoint rate limit", () => {
  let now = 1_000_000;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.post(
      "/demo",
      demoRateLimit({ perClient: 3, overall: 5 }, () => now),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    base = await listen(app);
  });
  const call = async (client: string) =>
    (await post(`${base}/demo`, {}, { "x-forwarded-for": `198.51.100.9, ${client}` })).status;

  it("one caller over its limit does not block the others", async () => {
    expect([await call("203.0.113.1"), await call("203.0.113.1"), await call("203.0.113.1")]).toEqual([
      200, 200, 200,
    ]);
    expect(await call("203.0.113.1")).toBe(429);
    expect(await call("203.0.113.1")).toBe(429); // refused calls do not use up the shared limit either
    expect(await call("203.0.113.2")).toBe(200);
  });

  it("all callers together are capped, and the window reopens after a minute", async () => {
    expect(await call("203.0.113.3")).toBe(200); // 5th accepted call overall
    const refused = await post(`${base}/demo`, {}, { "x-forwarded-for": "203.0.113.4" });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    now += 60_000;
    expect(await call("203.0.113.4")).toBe(200);
    expect(await call("203.0.113.1")).toBe(200);
  });

  it("the key is the last X-Forwarded-For entry: text a caller puts in front does not make a new caller", async () => {
    now += 60_000;
    const spoof = (fake: string) =>
      post(`${base}/demo`, {}, { "x-forwarded-for": `${fake}, 203.0.113.50` }).then((r) => r.status);
    expect([await spoof("1.1.1.1"), await spoof("2.2.2.2"), await spoof("3.3.3.3")]).toEqual([200, 200, 200]);
    expect(await spoof("4.4.4.4")).toBe(429);
  });
});

describe("self-hosted facilitator: request bodies", () => {
  let base = "";
  beforeAll(async () => {
    const { app } = createFacilitatorApp({ rpcUrl: "http://127.0.0.1:1", privateKey: generatePrivateKey() });
    base = await listen(app);
  });

  it("answers a body without paymentPayload/paymentRequirements with 400 JSON on both routes", async () => {
    for (const path of ["/verify", "/settle"]) {
      for (const payload of [
        {},
        { paymentPayload: {} },
        { paymentPayload: "x", paymentRequirements: [] },
        [1],
      ]) {
        const res = await post(`${base}${path}`, payload);
        expect(res.status, `${path} ${JSON.stringify(payload)}`).toBe(400);
        expect(res.headers.get("content-type")).toMatch(/application\/json/);
        expect(((await res.json()) as { error: string }).error).toBe("invalid request");
      }
    }
  });

  it("answers malformed JSON with 400 JSON, never an HTML page", async () => {
    const res = await post(`${base}/verify`, "{not json");
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/<html|at .*\.js/i);
  });

  it("an error thrown while verifying is a JSON 500 without a stack trace", async () => {
    const res = await post(`${base}/verify`, { paymentPayload: {}, paymentRequirements: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toMatch(/<html|node_modules|at .*\.(m?js|ts):\d+/i);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("still lists what it supports", async () => {
    const res = await fetch(`${base}/supported`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/eip155:43113/);
  });
});
