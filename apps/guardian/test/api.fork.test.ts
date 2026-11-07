// End-to-end on the Anvil fork (docs/SPEC.md §6, P7): the Guardian behind x402 with a self-hosted facilitator
// (the starter's pattern) settling on the fork, an agent paying with @x402/fetch, and AgentVault executing the
// verdicts. Needs `pnpm fork`, plus AGENT_PK, GUARDIAN_SIGNER_PK and PAY_TO in .env.local (testnet keys).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  agentVaultAbi,
  checkResponseSchema,
  FUJI_CAIP2,
  fujiChain,
  mockRouterAbi,
  USDC_FUJI,
  type CheckResponse,
  type Deployment,
} from "@guardian402/shared";
import { createApp } from "../src/app.ts";
import { TemplateExplainer } from "../src/explain/index.ts";
import { createFacilitatorApp } from "../src/facilitator.ts";
import { Pipeline } from "../src/pipeline.ts";
import { defaultRuleConfig, loadKnownContracts } from "../src/rules/index.ts";
import { createSigner } from "../src/sign/index.ts";
import { Simulator } from "../src/sim/index.ts";
import { Store } from "../src/store.ts";
import { createResourceServer } from "../src/x402.ts";
import { FORK_RPC_URL, setupFork, type ForkEnv } from "./fork-env.ts";

const need = (name: string): string => {
  const v = process.env[name] ?? "";
  if (!v) throw new Error(`set ${name} in .env.local`);
  return v;
};

let env: ForkEnv;
let a: Deployment;
let base = "";
let store: Store;
let sim: Simulator;
const servers: Server[] = [];
const agent = privateKeyToAccount(need("AGENT_PK") as Hex);
const payTo = need("PAY_TO") as Address;
const latencies: number[] = [];

const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(agent) }],
  spendControls: {
    allowedAssets: [{ network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: "20000" }],
  },
});

const listen = async (app: { listen: (port: number, host: string) => Server }) => {
  const s = app.listen(0, "127.0.0.1");
  servers.push(s);
  await new Promise((r) => s.once("listening", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

const usdcOf = (who: Address) =>
  env.client.readContract({ address: a.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const approve = (amount: bigint) => ({
  target: a.usdc,
  value: "0",
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.router, amount] }),
});
const swap = (amountIn: bigint, poolId: number, minOut: bigint) => ({
  target: a.router,
  value: "0",
  data: encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExactIn",
    args: [a.usdc, a.mWAVAX, amountIn, minOut, poolId, a.vault],
  }),
});
const S1 = () => ({ chainId: 43113, vault: a.vault, calls: [approve(2_000_000n), swap(2_000_000n, 0, 0n)] });
const S4 = () => ({ chainId: 43113, vault: a.vault, calls: [approve(2_000_000n), swap(2_000_000n, 1, 0n)] });

async function paid(path: string, body: unknown) {
  const t0 = performance.now();
  const res = await payingFetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, ms: performance.now() - t0 };
}

beforeAll(async () => {
  env = await setupFork();
  a = env.addresses;
  // Facilitator on the fork with a throwaway key funded by Anvil.
  const facKey = generatePrivateKey();
  const fac = createFacilitatorApp({ rpcUrl: FORK_RPC_URL, privateKey: facKey });
  await env.client.request({
    method: "anvil_setBalance",
    params: [fac.address, "0x56BC75E2D63100000"],
  } as never);
  await env.client.request({
    method: "anvil_setBalance",
    params: [agent.address, "0x56BC75E2D63100000"],
  } as never);
  const facilitatorUrl = await listen(fac.app);

  store = new Store(":memory:");
  sim = new Simulator({ forkRpcUrl: FORK_RPC_URL, knownTokens: [a.usdc, a.mWAVAX] });
  await sim.ensureForkHealthy(a.vault);
  const signer = createSigner(need("GUARDIAN_SIGNER_PK") as Hex);
  const pipeline = new Pipeline({
    chain: env.client,
    simulator: sim,
    explainer: new TemplateExplainer(),
    signer,
    store,
    deployment: a,
    knownContracts: loadKnownContracts("local"),
    demoMode: true,
  });
  const app = createApp({
    pipeline,
    store,
    ruleConfig: defaultRuleConfig,
    deployment: a,
    signerAddress: signer.address,
    payTo,
    demoMode: true,
    dashboardOrigin: "http://localhost:3000",
    resourceServer: createResourceServer({ facilitatorUrl, store }),
    forkBlock: () => env.client.getBlockNumber(),
  });
  base = await listen(app);
  // Warm the fork cache (first reads go to Fuji) so the latency numbers measure the Guardian, not the upstream.
  await sim.simulate(
    a.vault,
    S1().calls.map((c) => ({ ...c, value: 0n, data: c.data as Hex })),
  );
}, 180_000);

afterAll(() => {
  sim?.stop();
  for (const s of servers) s.close();
  store?.close();
});

describe("Guardian API behind x402 on the fork", () => {
  it("/v1/check: 402 without payment, then 200 after paying 0.005 USDC to PAY_TO; payment row stored", async () => {
    const unpaid = await fetch(`${base}/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(S1()),
    });
    expect(unpaid.status).toBe(402);

    const [agentBefore, payToBefore] = await Promise.all([usdcOf(agent.address), usdcOf(payTo)]);
    const { res } = await paid("/v1/check", S1());
    expect(res.status).toBe(200);
    const body = checkResponseSchema.parse(await res.json());
    expect(body.risk).toBe("LOW");
    const receipt = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE") ?? "");
    expect(receipt.success).toBe(true);
    expect(await usdcOf(agent.address)).toBe(agentBefore - 5000n);
    expect(await usdcOf(payTo)).toBe(payToBefore + 5000n);
    const row = store.payments(1)[0];
    expect(row).toMatchObject({
      amount: "5000",
      endpoint: "check",
      checkId: body.checkId,
      txHash: receipt.transaction,
    });
    console.log(`[e2e] settled on the fork: ${receipt.transaction}`);
  }, 60_000);

  it("an invalid body gets 400 and no USDC moves (not charged)", async () => {
    const before = await usdcOf(agent.address);
    const { res } = await paid("/v1/check", { ...S1(), chainId: 1 });
    expect(res.status).toBe(400);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeNull();
    expect(await usdcOf(agent.address)).toBe(before);
  }, 60_000);

  async function cosign(body: ReturnType<typeof S1>): Promise<CheckResponse> {
    const { res } = await paid("/v1/cosign", body);
    expect(res.status).toBe(200);
    return checkResponseSchema.parse(await res.json());
  }
  async function execute(body: ReturnType<typeof S1>, r: CheckResponse) {
    const v = r.verdict;
    if (!v) throw new Error("no verdict");
    const wallet = createWalletClient({ account: agent, chain: fujiChain, transport: http(FORK_RPC_URL) });
    const args = [
      body.calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data as Hex })),
      {
        callsHash: v.callsHash,
        nonce: BigInt(v.nonce),
        deadline: BigInt(v.deadline),
        risk: v.risk,
        checkId: v.checkId,
      },
      v.signature,
    ] as const;
    try {
      await env.client.simulateContract({
        account: agent,
        address: a.vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args,
      });
    } catch (e) {
      const revert =
        e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      return {
        reverted: revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : "unknown",
        args: revert instanceof ContractFunctionRevertedError ? revert.data?.args : undefined,
      };
    }
    const hash = await wallet.writeContract({
      address: a.vault,
      abi: agentVaultAbi,
      functionName: "executeBatch",
      args,
    });
    const receipt = await env.client.waitForTransactionReceipt({ hash });
    return { status: receipt.status };
  }

  it("/v1/cosign S1 (LOW): executeBatch with the verdict succeeds on the fork", async () => {
    const body = S1();
    const r = await cosign(body);
    expect(r.risk).toBe("LOW");
    expect(await execute(body, r)).toEqual({ status: "success" });
  }, 60_000);

  it("/v1/cosign S4 (HIGH slippage): the vault reverts RiskTooHigh", async () => {
    const body = S4();
    const r = await cosign(body);
    expect(r.risk).toBe("HIGH");
    expect(r.findings.map((f) => f.ruleId)).toEqual(["ABNORMAL_SLIPPAGE"]);
    const out = await execute(body, r);
    expect(out).toMatchObject({ reverted: "RiskTooHigh" });
  }, 60_000);

  it("latency of a paid /v1/check over 20 calls", async () => {
    for (let i = 0; i < 20; i++) {
      const { res, ms } = await paid("/v1/check", S1());
      expect(res.status).toBe(200);
      const body = checkResponseSchema.parse(await res.json());
      latencies.push(ms);
      if (i === 0) console.log(`[latency] pipeline only (latencyMs): ${body.latencyMs} ms`);
    }
    const s = [...latencies].sort((x, y) => x - y);
    const p = (q: number) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0);
    console.log(
      `[latency] paid /v1/check end to end (402 + sign + verify + pipeline + settle) over 20 calls: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`,
    );
    const pipe = store
      .recentChecks(20)
      .map((c) => c.latencyMs)
      .sort((x, y) => x - y);
    console.log(`[latency] pipeline (latencyMs) over the same 20: p50 ${pipe[10]} ms, p95 ${pipe[18]} ms`);
  }, 300_000);
});
