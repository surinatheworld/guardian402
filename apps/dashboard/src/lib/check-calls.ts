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

/**
 * Why `v` is not a usable address, or null. EIP-55: an address in mixed case must match its checksum (a wrong
 * case means a mistyped or altered character); all lowercase carries no checksum and is accepted. All-uppercase hex
 * is rejected, as viem's strict check does.
 */
export function addressProblem(v: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return "cần 0x và 40 ký tự 0–9, a–f";
  if (!isAddress(v))
    return "sai checksum EIP-55 (chữ hoa, chữ thường không khớp), có thể đã gõ nhầm một ký tự; dán lại địa chỉ từ ví hoặc viết toàn chữ thường";
  return null;
}
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
    if (typeof target !== "string") return { ok: false, error: `${at}: thiếu target (địa chỉ 0x…).` };
    const bad = addressProblem(target);
    if (bad) return { ok: false, error: `${at}: target ${bad}.` };
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
  const badRecipient = addressProblem(recipient);
  if (badRecipient) return { ok: false, error: `Người nhận không hợp lệ: ${badRecipient}.` };
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

/** token.approve(spender, amount), or the max uint256 when `unlimited`: what a dapp asks a wallet to sign. */
export function approveCall(
  token: Address,
  decimals: number,
  spender: string,
  amount: string,
  unlimited: boolean,
): Parsed<CallJson[]> {
  const who = spender.trim();
  const badSpender = addressProblem(who);
  if (badSpender) return { ok: false, error: `Địa chỉ được cấp quyền không hợp lệ: ${badSpender}.` };
  let units = 2n ** 256n - 1n;
  if (!unlimited) {
    const text = amount.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Số tiền phải là số." };
    if ((text.split(".")[1] ?? "").replace(/0+$/, "").length > decimals)
      return { ok: false, error: `Số tiền chỉ có tối đa ${decimals} chữ số thập phân.` };
    units = parseUnits(text, decimals);
    if (units >= 2n ** 256n) return { ok: false, error: "Số tiền vượt phạm vi cho phép." };
  }
  return {
    ok: true,
    value: [
      {
        target: token,
        value: "0",
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(who), units] }),
      },
    ],
  };
}

/** One raw transaction as a wallet shows it: to, value in AVAX, calldata. */
export function rawCall(to: string, avax: string, data: string): Parsed<CallJson[]> {
  const target = to.trim();
  const badTarget = addressProblem(target);
  if (badTarget) return { ok: false, error: `Địa chỉ nhận (to) không hợp lệ: ${badTarget}.` };
  const text = (avax.trim() || "0").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Số AVAX phải là số." };
  if ((text.split(".")[1] ?? "").length > 18)
    return { ok: false, error: "AVAX có tối đa 18 chữ số thập phân." };
  const hex = data.trim() || "0x";
  if (!HEX.test(hex) || hex.length % 2 !== 0)
    return { ok: false, error: "Dữ liệu (data) phải là hex bắt đầu bằng 0x, độ dài chẵn." };
  return {
    ok: true,
    value: [{ target: getAddress(target), value: parseUnits(text, 18).toString(), data: hex as Hex }],
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
  if (reasons.length) return { blocked: true, text: `Két sẽ từ chối giao dịch này: ${reasons.join("; ")}.` };
  if (maxAgentRisk !== undefined && r.riskCode > maxAgentRisk) {
    const max = RISK_LABEL[RISK_BY_CODE[maxAgentRisk] ?? "LOW"];
    return {
      blocked: true,
      text: `Rủi ro vượt mức két chấp nhận (tối đa: rủi ro ${max}): két sẽ từ chối khi cần Guardian duyệt.`,
    };
  }
  return { blocked: false, text: "Quy tắc của két không chặn giao dịch này." };
}
