// Pure helpers for the "Kiểm tra giao dịch" page: parse the calls JSON, build a USDC transfer, describe a call
// in one line, and state what the vault itself would do. No network, no signing.
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { mockRouterAbi, type CheckResponse, type RiskLevel } from "@guardian402/shared";
import { formatAmount, isUnlimited, shortHex } from "./format";
import { PRECHECK_REASON_LABEL, RISK_LABEL } from "./labels";
import type { CallJson } from "./presets";

export type { CallJson };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_CALLS = 8;
const HEX = /^0x[0-9a-fA-F]*$/;
const UINT = /^\d+$/;

/** The calls array the Guardian accepts: 1–8 items of { target, value, data }. Messages are for the owner. */
export function parseCalls(text: string): Parsed<CallJson[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON không hợp lệ. Cần một mảng [{ target, value, data }]." };
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CALLS)
    return { ok: false, error: `Cần một mảng có từ 1 tới ${MAX_CALLS} lệnh [{ target, value, data }].` };
  const calls: CallJson[] = [];
  for (const [i, item] of raw.entries()) {
    const at = `Lệnh ${i + 1}`;
    if (!item || typeof item !== "object") return { ok: false, error: `${at} phải là một object.` };
    const { target, value, data } = item as Record<string, unknown>;
    if (typeof target !== "string" || !isAddress(target, { strict: false }))
      return { ok: false, error: `${at}: target phải là địa chỉ 0x… hợp lệ.` };
    const v = value === undefined ? "0" : String(value);
    if (!UINT.test(v)) return { ok: false, error: `${at}: value phải là số nguyên (wei).` };
    const d = data === undefined ? "0x" : data;
    if (typeof d !== "string" || !HEX.test(d) || d.length % 2 !== 0)
      return { ok: false, error: `${at}: data phải là chuỗi hex 0x….` };
    calls.push({ target: getAddress(target), value: v, data: d as Hex });
  }
  return { ok: true, value: calls };
}

/** One ERC-20 transfer from the vault, amount typed by a person ("1,5" or "1.5"). */
export function transferCall(
  token: Address,
  decimals: number,
  to: string,
  amount: string,
): Parsed<CallJson[]> {
  const recipient = to.trim();
  if (!isAddress(recipient, { strict: false }))
    return { ok: false, error: "Người nhận phải là địa chỉ 0x… hợp lệ (42 ký tự)." };
  const text = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Số tiền phải là số lớn hơn 0." };
  if ((text.split(".")[1] ?? "").replace(/0+$/, "").length > decimals)
    return { ok: false, error: `Số tiền chỉ có tối đa ${decimals} chữ số thập phân.` };
  const units = parseUnits(text, decimals);
  if (units === 0n) return { ok: false, error: "Số tiền phải là số lớn hơn 0." };
  if (units >= 2n ** 256n) return { ok: false, error: "Số tiền vượt phạm vi cho phép." };
  return {
    ok: true,
    value: [
      {
        target: token,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(recipient), units],
        }),
      },
    ],
  };
}

type Meta = { symbol: string; decimals: number };

/** "USDC.approve(0xE20b…d1d9, không giới hạn)": what a call does, for the preview above the JSON. */
export function describeCall(call: CallJson, tokenMeta: (a: Address) => Meta | undefined): string {
  const token = tokenMeta(call.target);
  const name = token?.symbol ?? shortHex(call.target);
  if (call.data === "0x" || call.data.length < 10)
    return `Chuyển ${formatAmount(call.value, 18, 6)} AVAX cho ${shortHex(call.target)}`;
  try {
    const d = decodeFunctionData({ abi: erc20Abi, data: call.data });
    const dec = token?.decimals ?? 0;
    const amount = (x: bigint) => (isUnlimited(x) ? "không giới hạn" : `${formatAmount(x, dec, 6)} ${name}`);
    if (d.functionName === "transfer")
      return `${name}.transfer(${shortHex(d.args[0])}, ${amount(d.args[1])})`;
    if (d.functionName === "approve") return `${name}.approve(${shortHex(d.args[0])}, ${amount(d.args[1])})`;
  } catch {
    // Not an ERC-20 call; try the demo router next.
  }
  try {
    const d = decodeFunctionData({ abi: mockRouterAbi, data: call.data });
    return `Router.${d.functionName}(…)`;
  } catch {
    return `${name} · hàm ${call.data.slice(0, 10)}`;
  }
}

const RISK_BY_CODE: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * What the vault's own checks say about this batch, from the Guardian response and the on-chain policy:
 * a POLICY_PRECHECK finding means a static rule rejects it; otherwise a risk above maxAgentRisk means any
 * call that needs a verdict will revert with RiskTooHigh. The LLM text is never used here.
 */
export function vaultDecision(
  r: Pick<CheckResponse, "findings" | "riskCode">,
  maxAgentRisk: number | undefined,
): { blocked: boolean; text: string } {
  const reasons = r.findings
    .filter((f) => f.ruleId === "POLICY_PRECHECK")
    .map((f) => String(f.evidence.reason ?? ""))
    .map((reason) => PRECHECK_REASON_LABEL[reason] ?? reason)
    .filter((x, i, all) => x && all.indexOf(x) === i);
  if (reasons.length) return { blocked: true, text: `Vault sẽ từ chối lô lệnh này: ${reasons.join("; ")}.` };
  if (maxAgentRisk !== undefined && r.riskCode > maxAgentRisk) {
    const max = RISK_LABEL[RISK_BY_CODE[maxAgentRisk] ?? "LOW"];
    return {
      blocked: true,
      text: `Rủi ro vượt mức tối đa vault chấp nhận (${max}): lệnh cần verdict sẽ bị từ chối.`,
    };
  }
  return { blocked: false, text: "Luật của vault không chặn lô lệnh này." };
}
