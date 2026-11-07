// Log and revert decoding for the simulator (docs/SPEC.md §7). Pure functions, unit-tested without a fork.
import {
  BaseError,
  decodeErrorResult,
  decodeEventLog,
  getAddress,
  isHex,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { agentVaultAbi, mockErc20Abi, mockOracleAbi, mockRouterAbi } from "@guardian402/shared";
import type { ApprovalEvent, ApprovalForAllEvent, TransferEvent } from "./types.ts";

/** An approval at or above 2^128 counts as unlimited (SPEC §8 UNLIMITED_APPROVAL default). */
export const UNLIMITED_APPROVAL = 1n << 128n;

const eventsAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
]);

const errorsAbi = [...agentVaultAbi, ...mockRouterAbi, ...mockOracleAbi, ...mockErc20Abi].filter(
  (item) => item.type === "error",
) as Abi;

export type DecodedLogs = {
  transfers: TransferEvent[];
  approvals: ApprovalEvent[];
  approvalsForAll: ApprovalForAllEvent[];
};

/**
 * Decodes ERC-20 Transfer/Approval and ApprovalForAll. ERC-721 Transfer (tokenId indexed, no data) does not
 * match the ERC-20 shape and is skipped. Only approvals granted by `owner` (the vault) are kept.
 */
/** `callIndex` tags the transfers with the call that emitted them (each call is mined in its own block). */
export function decodeLogs(logs: readonly Log[], owner: Address, callIndex?: number): DecodedLogs {
  const out: DecodedLogs = { transfers: [], approvals: [], approvalsForAll: [] };
  const vault = owner.toLowerCase();
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: eventsAbi, data: log.data, topics: log.topics, strict: true });
    } catch {
      continue;
    }
    const token = getAddress(log.address); // RPC logs carry lowercase addresses
    if (decoded.eventName === "Transfer") {
      out.transfers.push({
        token,
        from: decoded.args.from,
        to: decoded.args.to,
        amount: decoded.args.value,
        ...(callIndex === undefined ? {} : { callIndex }),
      });
    } else if (decoded.eventName === "Approval") {
      if (decoded.args.owner.toLowerCase() !== vault) continue;
      const amount = decoded.args.value;
      out.approvals.push({
        token,
        owner: decoded.args.owner,
        spender: decoded.args.spender,
        amount,
        unlimited: amount >= UNLIMITED_APPROVAL,
      });
    } else {
      if (decoded.args.owner.toLowerCase() !== vault) continue;
      out.approvalsForAll.push({
        token,
        owner: decoded.args.owner,
        operator: decoded.args.operator,
        approved: decoded.args.approved,
      });
    }
  }
  return out;
}

/** Net token movement into (+) or out of (−) `account` according to the Transfer logs. */
export function netTransferDelta(
  transfers: readonly TransferEvent[],
  token: Address,
  account: Address,
): bigint {
  const t = token.toLowerCase();
  const a = account.toLowerCase();
  let delta = 0n;
  for (const tr of transfers) {
    if (tr.token.toLowerCase() !== t) continue;
    if (tr.to.toLowerCase() === a) delta += tr.amount;
    if (tr.from.toLowerCase() === a) delta -= tr.amount;
  }
  return delta;
}

/** Revert data → "ErrorName(arg, …)" using the vault, mock and ERC-20 ABIs; Error(string) and Panic too. */
export function decodeRevert(data: Hex | undefined): string {
  if (!data || data === "0x") return "reverted without data";
  try {
    const { errorName, args } = decodeErrorResult({ abi: errorsAbi, data });
    const rendered = (args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
    return `${errorName}(${rendered.join(", ")})`;
  } catch {
    return data;
  }
}

/** Finds revert data inside a viem error (estimateGas / sendTransaction failures). */
export function extractRevertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const found = error.walk((e) => {
    const data = (e as { data?: unknown }).data;
    return typeof data === "string" && isHex(data);
  }) as { data?: Hex } | null;
  return found?.data;
}
