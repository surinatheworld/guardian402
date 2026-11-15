import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import type { Call } from "@guardian402/shared";
import type { Context } from "./types.ts";

export const lc = (a: string) => a.toLowerCase();
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const SELECTOR_TRANSFER: Hex = "0xa9059cbb";
export const SELECTOR_APPROVE: Hex = "0x095ea7b3";

export const selectorOf = (data: Hex): Hex | undefined =>
  data.length >= 10 ? (data.slice(0, 10).toLowerCase() as Hex) : undefined;

/** An ERC-20 transfer or approve call, decoded only when the calldata is exactly selector + (address, uint256). */
export type Erc20Call = { kind: "transfer" | "approve"; to: Address; amount: bigint };

export function decodeErc20Call(data: Hex): Erc20Call | undefined {
  if (data.length !== 2 + 2 * 68) return undefined;
  const sel = selectorOf(data);
  if (sel !== SELECTOR_TRANSFER && sel !== SELECTOR_APPROVE) return undefined;
  try {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
    if (functionName !== "transfer" && functionName !== "approve") return undefined;
    const [to, amount] = args;
    return { kind: functionName, to: getAddress(to), amount };
  } catch {
    return undefined;
  }
}

export const trackedPolicy = (ctx: Context, token: Address) =>
  ctx.policy.tokens.find((t) => lc(t.token) === lc(token));

export const recipientSet = (ctx: Context) => new Set(ctx.policy.recipients.map(lc));
export const targetSet = (ctx: Context) => new Set(ctx.policy.targets.map((t) => lc(t.target)));

/** Vault allowlist + known-contracts registry + addresses the vault has paid before (SPEC §8). */
export function addressBook(ctx: Context): Set<string> {
  return new Set([
    ...ctx.policy.recipients.map(lc),
    ...ctx.policy.targets.map((t) => lc(t.target)),
    ...Object.keys(ctx.knownContracts).map(lc),
    ...ctx.addressBook.map(lc),
    lc(ctx.vault),
  ]);
}

/** Calls of the batch, each with its index. */
export const indexed = (calls: readonly Call[]) => calls.map((call, index) => ({ call, index }));
