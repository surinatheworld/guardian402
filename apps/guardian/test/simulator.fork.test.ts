// Simulator integration tests on the Anvil fork (SPEC §7, P4). Run: `pnpm fork`, then
// `pnpm --filter @guardian402/guardian test:fork`.
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
  parseEther,
  type Address,
} from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FUJI_RPC_URL,
  fujiChain,
  getAddresses,
  mockRouterAbi,
  type Call,
  type Deployment,
} from "@guardian402/shared";
import { Simulator } from "../src/sim/index.ts";
import { ATTACKER, FORK_RPC_URL, setupFork, type ForkEnv } from "./fork-env.ts";

let env: ForkEnv;
let a: Deployment;
let sim: Simulator;
const treasury = (d: Deployment): Address => d.deployer;

const approve = (spender: Address, amount: bigint): Call => ({
  target: a.usdc,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});
const transfer = (to: Address, amount: bigint): Call => ({
  target: a.usdc,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});
const swap = (amountIn: bigint, poolId: number, minOut: bigint): Call => ({
  target: a.router,
  value: 0n,
  data: encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExactIn",
    args: [a.usdc, a.mWAVAX, amountIn, minOut, poolId, a.vault],
  }),
});
const usdcOf = (who: Address) =>
  env.client.readContract({ address: a.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const quote = (amountIn: bigint, poolId: number) =>
  env.client.readContract({
    address: a.router,
    abi: mockRouterAbi,
    functionName: "quote",
    args: [a.usdc, a.mWAVAX, amountIn, poolId],
  });

beforeAll(async () => {
  env = await setupFork();
  a = env.addresses;
  // Correctness tests allow a cold fork (first reads go to Fuji); the latency test uses the 800 ms default.
  sim = new Simulator({ forkRpcUrl: FORK_RPC_URL, knownTokens: [a.usdc, a.mWAVAX], timeoutMs: 60_000 });
  await sim.ensureForkHealthy(a.vault);
});

describe("Simulator on the fork", () => {
  it("normal swap via pool 0: exact USDC and mWAVAX deltas, state reverted", async () => {
    const vaultUsdcBefore = await usdcOf(a.vault);
    const expectedOut = await quote(2_000_000n, 0);
    const r = await sim.simulate(
      a.vault,
      [approve(a.router, 2_000_000n), swap(2_000_000n, 0, expectedOut)],
      [a.usdc],
    );

    expect(r.success).toBe(true);
    expect(r.forkBlock).toBeGreaterThan(0n);
    expect(r.tokenDeltas.find((d) => d.token === a.usdc)?.delta).toBe(-2_000_000n);
    const wavax = r.tokenDeltas.find((d) => d.token === a.mWAVAX);
    expect(wavax?.delta).toBe(expectedOut);
    expect(wavax).toMatchObject({ symbol: "mWAVAX", decimals: 18 });
    expect(r.approvals).toEqual([
      { token: a.usdc, owner: a.vault, spender: a.router, amount: 2_000_000n, unlimited: false },
    ]);
    expect(r.transfers).toEqual(
      expect.arrayContaining([
        { token: a.usdc, from: a.vault, to: a.router, amount: 2_000_000n },
        { token: a.mWAVAX, from: a.router, to: a.vault, amount: expectedOut },
      ]),
    );
    expect(r.nativeDelta).toBe(0n);
    expect(await usdcOf(a.vault)).toBe(vaultUsdcBefore); // snapshot reverted
  });

  it("transfer to an attacker: transfer decoded, delta exact", async () => {
    const r = await sim.simulate(a.vault, [transfer(ATTACKER, 5_000_000n)], [a.usdc]);
    expect(r.success).toBe(true);
    expect(r.transfers).toEqual([{ token: a.usdc, from: a.vault, to: ATTACKER, amount: 5_000_000n }]);
    expect(r.tokenDeltas.find((d) => d.token === a.usdc)?.delta).toBe(-5_000_000n);
    expect(await usdcOf(ATTACKER)).toBe(0n);
  });

  it("approve max uint: approval decoded with unlimited = true", async () => {
    const r = await sim.simulate(a.vault, [approve(ATTACKER, maxUint256)], [a.usdc]);
    expect(r.success).toBe(true);
    expect(r.approvals).toEqual([
      { token: a.usdc, owner: a.vault, spender: ATTACKER, amount: maxUint256, unlimited: true },
    ]);
    expect(r.tokenDeltas.find((d) => d.token === a.usdc)?.delta).toBe(0n);
  });

  it("a reverting call: success = false with the decoded custom error", async () => {
    const out = await quote(2_000_000n, 1);
    const r = await sim.simulate(a.vault, [approve(a.router, 2_000_000n), swap(2_000_000n, 1, out + 1n)]);
    expect(r.success).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.failedCallIndex).toBe(1);
    expect(r.revertReason).toBe(`InsufficientOutput(${out}, ${out + 1n})`);
  });

  it("a reverting call: Error(string) from the real Fuji USDC", async () => {
    const r = await sim.simulate(a.vault, [swap(2_000_000n, 0, 0n)]); // no approval first
    expect(r.success).toBe(false);
    expect(r.failedCallIndex).toBe(0);
    expect(r.revertReason).toMatch(/^Error\(ERC20: .*allowance/);
  });

  it("a native transfer: native delta exact, gas excluded", async () => {
    const value = parseEther("0.01");
    const r = await sim.simulate(a.vault, [{ target: treasury(a), value, data: "0x" }]);
    expect(r.success).toBe(true);
    expect(r.gasUsed).toBeGreaterThan(0n);
    expect(r.nativeDelta).toBe(-value);
  });

  it("parallel requests are serialized by the mutex and give identical results", async () => {
    const calls = [transfer(treasury(a), 1_000_000n)];
    const results = await Promise.all([1, 2, 3].map(() => sim.simulate(a.vault, calls, [a.usdc])));
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.tokenDeltas.find((d) => d.token === a.usdc)?.delta).toBe(-1_000_000n);
    }
  });

  it("a timeout becomes a failed result and leaves the fork clean", async () => {
    const hasty = new Simulator({ forkRpcUrl: FORK_RPC_URL, timeoutMs: 1 });
    const r = await hasty.simulate(a.vault, [transfer(treasury(a), 1n)]);
    expect(r).toMatchObject({ success: false, timedOut: true });
    expect(r.revertReason).toMatch(/timed out after 1 ms/);
    await hasty.ensureForkHealthy(a.vault); // waits for the timed-out run to revert its snapshot
    expect(await usdcOf(a.vault)).toBeGreaterThanOrEqual(10_000_000n);
    const ok = await sim.simulate(a.vault, [transfer(treasury(a), 1n)], [a.usdc]);
    expect(ok.success).toBe(true);
  });

  it("fails cleanly when the vault has no code on the fork", async () => {
    const r = await sim.simulate("0x00000000000000000000000000000000000b0b01", [transfer(treasury(a), 1n)]);
    expect(r.success).toBe(false);
    expect(r.revertReason).toMatch(/has no code on the fork/);
  });

  it("latency over 20 runs (target p50 < 800 ms)", async () => {
    const fast = new Simulator({ forkRpcUrl: FORK_RPC_URL, knownTokens: [a.usdc, a.mWAVAX] });
    const calls = [approve(a.router, 2_000_000n), swap(2_000_000n, 0, 0n)];
    await fast.simulate(a.vault, calls, [a.usdc]); // warm-up (token metadata cache, fork state)
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await fast.simulate(a.vault, calls, [a.usdc]);
      expect(r.success).toBe(true);
      ms.push(r.durationMs);
    }
    ms.sort((x, y) => x - y);
    const p50 = ms[9] ?? Infinity;
    const p95 = ms[18] ?? Infinity;
    console.log(`[latency] simulate() over 20 runs: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`);
    expect(p50).toBeLessThan(800);
  });

  // Last on purpose: it resets the fork to the latest Fuji block. The Fuji deployment exists there.
  it("with an upstream, resets a stale fork to the latest Fuji block", async () => {
    const fuji = getAddresses("fuji");
    const upstream = createPublicClient({ chain: fujiChain, transport: http(FUJI_RPC_URL) });
    const before = await env.client.getBlockNumber();
    const fresh = new Simulator({
      forkRpcUrl: FORK_RPC_URL,
      upstreamRpcUrl: FUJI_RPC_URL,
      resetIntervalMs: 0,
    });
    await fresh.ensureForkHealthy(fuji.vault);
    const latest = await upstream.getBlockNumber();
    const head = await env.client.getBlockNumber();
    expect(head).toBeGreaterThanOrEqual(before);
    expect(latest - head).toBeLessThan(10n);
    expect(await env.client.getCode({ address: fuji.vault })).toBeDefined();
  });
});
