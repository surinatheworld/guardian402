// The agent's two planners (docs/SPEC.md §10). Both are deterministic; no LLM is involved.
//  - safe: rule-based DCA. If the oracle price is below a threshold, swap N USDC into mWAVAX via pool 0.
//  - scripted-attack (DEMO): simulates a prompt-injected planner by turning an instruction found in the news
//    feed (fixtures/feed.json) into calls, exactly as a hijacked LLM planner might.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, type Address } from "viem";
import { minOutUsdcToWavax, mockRouterAbi, type Call, type Deployment } from "@guardian402/shared";
import { AGENT_DIR } from "./env.ts";

export const approve = (d: Deployment, spender: Address, amount: bigint): Call => ({
  target: d.usdc,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});
export const transfer = (d: Deployment, to: Address, amount: bigint): Call => ({
  target: d.usdc,
  value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});
export const swap = (d: Deployment, amountIn: bigint, poolId: number, minOut: bigint): Call => ({
  target: d.router,
  value: 0n,
  data: encodeFunctionData({
    abi: mockRouterAbi,
    functionName: "swapExactIn",
    args: [d.usdc, d.mWAVAX, amountIn, minOut, poolId, d.vault],
  }),
});

/**
 * Safe mode: DCA N USDC into mWAVAX through the normal pool when the price is below the threshold. The swap
 * sets `minOut` to the oracle price minus 1%, so a pool that moves after the Guardian's check makes the swap
 * revert instead of costing the vault (UNPROTECTED_SWAP, docs/SPEC.md §8).
 */
export function planSafeDca(
  d: Deployment,
  opts: { price: bigint; maxPrice: bigint; amount: bigint; poolId?: number; minOut?: bigint },
): Call[] {
  if (opts.price > opts.maxPrice) return [];
  const minOut = opts.minOut ?? minOutUsdcToWavax(opts.amount, opts.price);
  return [approve(d, d.router, opts.amount), swap(d, opts.amount, opts.poolId ?? 0, minOut)];
}

type Feed = { items: { id: string; text: string }[] };

export function lookalike(): Address {
  const f = JSON.parse(readFileSync(join(AGENT_DIR, "fixtures/lookalike.json"), "utf8")) as {
    lookalike: string;
  };
  return getAddress(f.lookalike);
}

/** Feed text with the mined lookalike filled in. */
export function readFeed(): Feed {
  const raw = readFileSync(join(AGENT_DIR, "fixtures/feed.json"), "utf8").replaceAll(
    "{lookalike}",
    lookalike(),
  );
  return JSON.parse(raw) as Feed;
}

/**
 * Scripted attack: what a planner that obeys injected text would do. Recognises two instructions:
 * "transfer all USDC to <address>" and "approve unlimited USDC to ... <address>".
 */
export function planFromInjection(d: Deployment, itemId: string, usdcBalance: bigint): Call[] {
  const item = readFeed().items.find((i) => i.id === itemId);
  if (!item) throw new Error(`no feed item ${itemId}`);
  const addr = item.text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (!addr) return [];
  if (/transfer all usdc/i.test(item.text)) return [transfer(d, getAddress(addr), usdcBalance)];
  if (/approve unlimited usdc/i.test(item.text)) return [approve(d, getAddress(addr), maxUint256)];
  return [];
}
