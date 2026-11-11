// Call lists for the "Kiểm tra giao dịch" page, built like apps/agent/src/planner.ts. DEMO: S2 and S3 are
// scripted attacks; LOOKALIKE is the mined lookalike of the agent's fixture (`pnpm mine-lookalike` rewrites it).
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, type Address, type Hex } from "viem";
import { DEMO_ORACLE_PRICE, minOutUsdcToWavax, mockRouterAbi, type Deployment } from "@guardian402/shared";
import lookalikeFixture from "../../../agent/fixtures/lookalike.json";

export const LOOKALIKE: Address = getAddress(lookalikeFixture.lookalike);
export const ATTACKER: Address = "0x000000000000000000000000000000000000a77A";

export type CallJson = { target: Address; value: string; data: Hex };

const approve = (d: Deployment, spender: Address, amount: bigint): CallJson => ({
  target: d.usdc,
  value: "0",
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

const swap = (d: Deployment, amountIn: bigint, poolId: number, minOut = 0n): CallJson => ({
  target: d.router,
  value: "0",
  data: encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExactIn",
    args: [d.usdc, d.mWAVAX, amountIn, minOut, poolId, d.vault],
  }),
});

export type Preset = { id: string; label: string; calls: (d: Deployment, usdcBalance: bigint) => CallJson[] };

export const PRESETS: Preset[] = [
  {
    id: "S0",
    label: "S0 · Chuyển 1.5 USDC cho Treasury (an toàn)",
    calls: (d) => [
      {
        target: d.usdc,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [d.deployer, 1_500_000n],
        }),
      },
    ],
  },
  {
    id: "S1",
    label: "S1 · Swap 2 USDC sang mWAVAX qua pool thường",
    // minOut as the safe agent sets it (DEMO oracle price minus 1%), so S1 stays LOW under UNPROTECTED_SWAP.
    calls: (d) => [
      approve(d, d.router, 2_000_000n),
      swap(d, 2_000_000n, 0, minOutUsdcToWavax(2_000_000n, DEMO_ORACLE_PRICE)),
    ],
  },
  {
    id: "S2",
    label: "S2 · Chuyển toàn bộ USDC cho kẻ tấn công (DEMO)",
    calls: (d, balance) => [
      {
        target: d.usdc,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [ATTACKER, balance > 0n ? balance : 1_000_000n],
        }),
      },
    ],
  },
  {
    id: "S3",
    label: "S3 · Cấp quyền không giới hạn cho địa chỉ nhái router (DEMO)",
    calls: (d) => [approve(d, LOOKALIKE, maxUint256)],
  },
  {
    id: "S4",
    label: "S4 · Swap 2 USDC qua pool lệch giá, minOut = 0",
    calls: (d) => [approve(d, d.router, 2_000_000n), swap(d, 2_000_000n, 1)],
  },
];
