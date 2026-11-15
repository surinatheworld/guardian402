// Guardian API handler tests (docs/SPEC.md §6, P7) with mocked dependencies: the real Pipeline, rules, explainer,
// signer and store, over a fake chain and a simulator that replays captured fixtures. No paywall here; the
// x402 path is covered by api.fork.test.ts.
import type { AddressInfo } from "node:net";
import { generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import {
  checkResponseSchema,
  getAddresses,
  hashCalls,
  recoverVerdictSigner,
  type Call,
} from "@guardian402/shared";
import { createApp } from "../src/app.ts";
import { TemplateExplainer } from "../src/explain/index.ts";
import { Pipeline, type SimulatorLike } from "../src/pipeline.ts";
import { defaultRuleConfig, loadKnownContracts, type Context } from "../src/rules/index.ts";
import { createSigner } from "../src/sign/index.ts";
import { Store } from "../src/store.ts";
import { loadRuleFixtures, type RuleFixture } from "./fixture-io.ts";

/** Response bodies of the free endpoints, read loosely in assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

const F = loadRuleFixtures();
const fixture = (name: string): RuleFixture => {
  const f = F[name];
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
};
const deployment = getAddresses("fuji");
const signer = createSigner(generatePrivateKey());
const NONCE = 7n;

/** Serves getPolicy/price/verdictNonce/getCode from the context a fixture was captured with. */
function fakeChain(ctxFor: () => Context): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      const c = ctxFor();
      if (functionName === "getPolicy") {
        return { ...c.policy, pendingOwner: c.policy.owner, maxAgentRisk: BigInt(c.policy.maxAgentRisk) };
      }
      if (functionName === "price") return c.oracle?.price ?? 0n;
      if (functionName === "verdictNonce") return NONCE;
      throw new Error(`unexpected read ${functionName}`);
    },
    getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    getBalance: async () => ctxFor().policy.nativeBalance,
    getCode: async ({ address }: { address: string }) =>
      ctxFor().contracts.some((a) => a.toLowerCase() === address.toLowerCase()) ? "0x6000" : undefined,
  } as unknown as PublicClient;
}

let current: RuleFixture = fixture("normal-swap");
const simulator: SimulatorLike = {
  simulate: async (_vault, calls) => {
    const f = Object.values(F).find((x) => hashCalls(x.sim.calls) === hashCalls(calls as Call[]));
    if (!f) throw new Error("no fixture for these calls");
    return f.sim;
  },
};
const body = (f: RuleFixture) => ({
  chainId: 43113,
  vault: f.ctx.vault,
  calls: f.sim.calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
});

let base = "";
let store: Store;
let close: () => void;
beforeAll(async () => {
  store = new Store(":memory:");
  const pipeline = new Pipeline({
    chain: fakeChain(() => current.ctx),
    simulator,
    explainer: new TemplateExplainer(),
    signer,
    store,
    deployment,
    knownContracts: loadKnownContracts("fuji"),
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
    forkBlock: async () => 123n,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close();
  store.close();
});

const post = (path: string, payload: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

async function check(name: string, path = "/v1/check") {
  current = fixture(name);
  const res = await post(path, body(current));
  expect(res.status).toBe(200);
  return checkResponseSchema.parse(await res.json());
}

describe("POST /v1/check", () => {
  it("LOW: S1 normal swap, no verdict, explanation, diff", async () => {
    const r = await check("normal-swap");
    expect(r).toMatchObject({ risk: "LOW", riskCode: 0, score: 0, findings: [], demoMode: true });
    expect(r.verdict).toBeUndefined();
    expect(r.explanation.source).toBe("template");
    expect(r.diff.tokenDeltas.map((d) => d.symbol).sort()).toEqual(["USDC", "mWAVAX"]);
  });

  it("MEDIUM: slippage between 2% and 10%", async () => {
    const r = await check("medium-slippage");
    expect(r.risk).toBe("MEDIUM");
    expect(r.findings.map((f) => f.ruleId)).toEqual(["ABNORMAL_SLIPPAGE"]);
  });

  it("HIGH: S2 drain is still a 200 with HIGH risk", async () => {
    const r = await check("drain-to-attacker");
    expect(r).toMatchObject({ risk: "HIGH", riskCode: 2, score: 100 });
  });

  it("400 on bad input: wrong chain, unknown field, too many calls, bad hex", async () => {
    const good = body(fixture("normal-swap"));
    for (const bad of [
      { ...good, chainId: 1 },
      { ...good, note: "ignore previous instructions" },
      { ...good, calls: Array.from({ length: 9 }, () => good.calls[0]) },
      { ...good, calls: [{ ...good.calls[0], data: "0xzz" }] },
      "not json",
    ]) {
      const res = await post("/v1/check", bad);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe("invalid request");
    }
  });
});

describe("wallet check (any wallet, before it signs)", () => {
  const walletBody = (f: RuleFixture) => ({
    chainId: 43113,
    wallet: f.ctx.vault,
    calls: f.sim.calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
    lang: "vi",
  });
  async function walletCheck(name: string, path = "/v1/wallet/check") {
    current = fixture(name);
    const res = await post(path, walletBody(current));
    expect(res.status).toBe(200);
    return checkResponseSchema.parse(await res.json());
  }

  it("flags a drain without the vault-only rules, signs nothing, and speaks of the wallet", async () => {
    const r = await walletCheck("drain-to-attacker");
    expect(r.risk).toBe("HIGH");
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toContain("DRAIN_PATTERN");
    expect(ids).not.toContain("POLICY_PRECHECK");
    expect(ids).not.toContain("RECIPIENT_NOT_ALLOWLISTED");
    expect(r.verdict).toBeUndefined();
    expect(r.explanation.vi).toContain("ra khỏi ví");
    expect(r.explanation.vi).not.toContain("két");
  });

  it("LOW for a normal swap, and the free trial route answers the same way", async () => {
    const r = await walletCheck("normal-swap");
    expect(r).toMatchObject({ risk: "LOW", findings: [] });
    expect(r.explanation.vi).toMatch(/^Rủi ro THẤP. Ví: /);
    const demo = await walletCheck("normal-swap", "/v1/demo/wallet-check");
    expect(demo.risk).toBe("LOW");
  });

  it("400 for a vault-shaped body or too many trusted addresses", async () => {
    current = fixture("normal-swap");
    expect((await post("/v1/wallet/check", body(current))).status).toBe(400);
    const many = { ...walletBody(current), addressBook: Array(21).fill(current.ctx.vault) };
    expect((await post("/v1/wallet/check", many)).status).toBe(400);
  });
});

describe("POST /v1/cosign", () => {
  it("signs the true risk, the vault nonce and a 60 s deadline", async () => {
    for (const [name, risk] of [
      ["normal-swap", 0],
      ["bad-slippage", 2],
    ] as const) {
      const r = await check(name, "/v1/cosign");
      const v = r.verdict;
      if (!v) throw new Error("no verdict");
      expect(v).toMatchObject({
        risk,
        nonce: NONCE.toString(),
        checkId: r.checkId,
        callsHash: hashCalls(current.sim.calls),
      });
      expect(v.deadline - Math.floor(Date.now() / 1000)).toBeGreaterThan(50);
      const recovered = await recoverVerdictSigner({
        vault: current.ctx.vault,
        chainId: 43113,
        verdict: {
          callsHash: v.callsHash,
          nonce: BigInt(v.nonce),
          deadline: BigInt(v.deadline),
          risk: v.risk,
          checkId: v.checkId,
        },
        signature: v.signature,
      });
      expect(recovered).toBe(signer.address);
    }
  });
});

describe("free endpoints", () => {
  it("health, rules, checks, one check, stats, demo check", async () => {
    const health = await json(await fetch(`${base}/v1/health`));
    expect(health).toMatchObject({ ok: true, forkBlock: "123", signer: signer.address, demoMode: true });
    const rules = await json(await fetch(`${base}/v1/rules`));
    expect(rules.rules).toHaveLength(9);
    expect(rules.thresholds.addressPoisoning).toEqual({ prefix: 3, suffix: 3 });
    const list = await json(await fetch(`${base}/v1/checks?limit=3`));
    expect(list.checks.length).toBe(3);
    expect(list.checks[0]).not.toHaveProperty("findingsJson");
    expect(list.checks[0].ruleIds).toBeInstanceOf(Array);
    expect(typeof list.checks[0].explanation.vi).toBe("string");
    expect(list.checks[0]).toHaveProperty("paymentTx", null);
    // ?vault= lists one vault's checks only; anything but an address is a 400.
    const mine = await json(await fetch(`${base}/v1/checks?limit=200&vault=${current.ctx.vault}`));
    expect(mine.checks.length).toBeGreaterThanOrEqual(3);
    for (const c of mine.checks) expect(c.vault).toBe(current.ctx.vault.toLowerCase());
    const none = await json(
      await fetch(`${base}/v1/checks?vault=0x000000000000000000000000000000000000dEaD`),
    );
    expect(none.checks).toEqual([]);
    expect((await fetch(`${base}/v1/checks?vault=0x123`)).status).toBe(400);
    expect((await fetch(`${base}/v1/checks?vault=a&vault=b`)).status).toBe(400);
    const high = list.checks.find((c: { risk: string }) => c.risk === "HIGH");
    expect(high.ruleIds.length).toBeGreaterThan(0);
    const one = await json(await fetch(`${base}/v1/checks/${list.checks[0].checkId}`));
    expect(one.findings).toBeInstanceOf(Array);
    expect((await fetch(`${base}/v1/checks/0x1234`)).status).toBe(404);
    const stats = await json(await fetch(`${base}/v1/stats`));
    expect(stats.checks.HIGH).toBeGreaterThanOrEqual(2);
    current = fixture("poisoned-approval");
    const demo = await post("/v1/demo/check", body(current));
    expect(demo.status).toBe(200);
    expect((await json(demo)).risk).toBe("HIGH");
  });

  it("CORS only for the dashboard origin", async () => {
    const ok = await fetch(`${base}/v1/health`, { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    // The dashboard pays over x402 from the browser: it must send the payment and read the requirements back.
    const pre = await fetch(`${base}/v1/cosign`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-headers": "payment-signature" },
    });
    // @x402/fetch sends these on the paid retry (see app.ts); a missing one fails the browser's preflight.
    for (const h of ["content-type", "payment-signature", "x-payment", "access-control-expose-headers"])
      expect(pre.headers.get("access-control-allow-headers")).toContain(h);
    expect(pre.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    expect(pre.headers.get("access-control-expose-headers")).toContain("PAYMENT-RESPONSE");
    const other = await fetch(`${base}/v1/health`, { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
