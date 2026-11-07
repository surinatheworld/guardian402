// Captures real SimResult objects on the Anvil fork and saves them, with the context they ran in, as rule
// fixtures in apps/guardian/test/fixtures/rules/*.json (P5). Needs `pnpm fork` running.
// Run: pnpm --filter @guardian402/guardian fixtures:rules
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, parseEther, type Address } from "viem";
import { mockRouterAbi, type Call } from "@guardian402/shared";
import { buildContext, readOracle, readPolicy, withCode } from "../src/context.ts";
import { loadKnownContracts } from "../src/rules/known-contracts.ts";
import type { Context } from "../src/rules/types.ts";
import { Simulator } from "../src/sim/index.ts";
import { ATTACKER, FORK_RPC_URL, setupFork } from "../test/fork-env.ts";
import { RULE_FIXTURES_DIR, toJson, type RuleFixture } from "../test/fixture-io.ts";

const env = await setupFork();
const a = env.addresses;
const sim = new Simulator({ forkRpcUrl: FORK_RPC_URL, knownTokens: [a.usdc, a.mWAVAX], timeoutMs: 60_000 });
await sim.ensureForkHealthy(a.vault);

const policy = await readPolicy(env.client, a.vault);
const oracle = await readOracle(env.client, a);
const knownContracts = loadKnownContracts("local");
const treasury = a.deployer;
/** Same first 4 and last 4 hex characters as the router; never funded, nobody holds its key. */
const LOOKALIKE_ROUTER = getAddress(
  `0x${a.router.slice(2, 6)}badc0ffee0ddf00dbadc0ffee0ddf00d${a.router.slice(-4)}`.toLowerCase(),
);
/** A contract on Fuji that is not in the known-contracts registry (the P1 Cancun smoke test). */
const UNKNOWN_CONTRACT: Address = "0x0D363882aA2DdA271323F91a1a268Cd707D3C426";
const usdcBalance = policy.tokens.find((t) => t.token.toLowerCase() === a.usdc.toLowerCase())?.balance ?? 0n;

const erc20 = (fn: "transfer" | "approve", to: Address, amount: bigint): Call => ({
  target: a.usdc,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: fn, args: [to, amount] }),
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
const smokeCall: Call = {
  target: UNKNOWN_CONTRACT,
  value: 0n,
  data: encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "checkTransient",
        inputs: [{ type: "uint256" }],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
    functionName: "checkTransient",
    args: [1n],
  }),
};

type Case = { name: string; description: string; calls: Call[]; tweak?: (ctx: Context) => Context };
const cases: Case[] = [
  {
    name: "normal-swap",
    description: "S1: approve 2 USDC to the router, swap via pool 0",
    calls: [erc20("approve", a.router, 2_000_000n), swap(2_000_000n, 0, 0n)],
  },
  {
    name: "bad-slippage",
    description: "S4: approve 2 USDC, swap via the thin pool 1 with minOut 0",
    calls: [erc20("approve", a.router, 2_000_000n), swap(2_000_000n, 1, 0n)],
  },
  {
    name: "medium-slippage",
    description: "S1 swap, with the reference price in the context lowered 4.7% (≈5% slippage against it)",
    calls: [erc20("approve", a.router, 2_000_000n), swap(2_000_000n, 0, 0n)],
    tweak: (ctx) => ({ ...ctx, oracle: { ...oracle, price: (oracle.price * 953n) / 1000n } }),
  },
  {
    name: "drain-to-attacker",
    description: "S2: transfer the whole USDC balance to an attacker",
    calls: [erc20("transfer", ATTACKER, usdcBalance)],
  },
  {
    name: "poisoned-approval",
    description: "S3: approve max uint to a lookalike of the router",
    calls: [erc20("approve", LOOKALIKE_ROUTER, maxUint256)],
  },
  {
    name: "oversized-approval",
    description: "approve 15 USDC to the router (maxApproval is 10)",
    calls: [erc20("approve", a.router, 15_000_000n)],
  },
  {
    name: "exact-approval",
    description: "approve exactly 2 USDC to the router",
    calls: [erc20("approve", a.router, 2_000_000n)],
  },
  {
    name: "revoke-approval",
    description: "approve 0 to the router (revocation)",
    calls: [erc20("approve", a.router, 0n)],
  },
  {
    name: "treasury-transfer",
    description: "transfer 1 USDC to the team treasury (allowlisted)",
    calls: [erc20("transfer", treasury, 1_000_000n)],
  },
  {
    name: "reverting-swap",
    description: "approve 2 USDC, swap with an impossible minOut (reverts)",
    calls: [erc20("approve", a.router, 2_000_000n), swap(2_000_000n, 0, maxUint256)],
  },
  {
    name: "unknown-contract-call",
    description: "call a contract that is not in the registry",
    calls: [smokeCall],
  },
  {
    name: "unknown-contract-approval",
    description: "approve 1 USDC to a contract that is not in the registry",
    calls: [erc20("approve", UNKNOWN_CONTRACT, 1_000_000n)],
  },
  {
    name: "native-to-attacker",
    description: "send 0.01 AVAX to an attacker",
    calls: [{ target: ATTACKER, value: parseEther("0.01"), data: "0x" }],
  },
  {
    name: "cap-nearly-spent",
    description: "S1 swap when 19 of the 20 USDC daily cap is already spent (context override)",
    calls: [erc20("approve", a.router, 2_000_000n), swap(2_000_000n, 0, 0n)],
    tweak: (ctx) => ({
      ...ctx,
      policy: {
        ...ctx.policy,
        tokens: ctx.policy.tokens.map((t) =>
          t.token.toLowerCase() === a.usdc.toLowerCase() ? { ...t, spentToday: 19_000_000n } : t,
        ),
      },
    }),
  },
];

mkdirSync(RULE_FIXTURES_DIR, { recursive: true });
const tracked = policy.tokens.map((t) => t.token);
for (const c of cases) {
  const result = await sim.simulate(a.vault, c.calls, tracked);
  const touched = [
    ...c.calls.map((x) => x.target),
    ...result.approvals.map((x) => x.spender),
    ...result.transfers.map((x) => x.to),
  ];
  let ctx = buildContext({
    vault: a.vault,
    policy,
    knownContracts,
    contracts: await withCode(env.client, touched),
    oracle,
    demoMode: false,
  });
  if (c.tweak) ctx = c.tweak(ctx);
  const fixture: RuleFixture = { name: c.name, description: c.description, sim: result, ctx };
  writeFileSync(join(RULE_FIXTURES_DIR, `${c.name}.json`), `${toJson(fixture)}\n`);
  console.log(`[fixtures] ${c.name}: success=${result.success} ${result.durationMs} ms`);
}
sim.stop();
