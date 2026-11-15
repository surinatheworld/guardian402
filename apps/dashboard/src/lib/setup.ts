// The vault a new owner creates in /bat-dau, as a draft the steps fill in, and the AgentVault.Config it becomes
// (SPEC §4.10). Pure: no React, no chain. Amounts in the draft are whole USDC; the config is in base units.
import { getAddress, isAddress, parseUnits, type Address } from "viem";

export type Recipient = { name: string; address: string };

export type SetupDraft = {
  vaultLabel: string;
  agentName: string;
  agentAddress: string;
  recipients: Recipient[];
  /** Whole USDC. */
  dailyCap: number;
  /** Whole USDC; 0 = no per-transaction cap. */
  maxPerTx: number;
  /** Whole USDC; 0 = no total budget. */
  budget: number;
  /**
   * Whole USDC. A payment of at most this much to an allowed recipient runs without the Guardian, so it costs no
   * Guardian fee (the vault's caps still apply). 0 = every payment needs the Guardian. The vault's
   * `verdictThreshold`.
   */
  freeBelow: number;
  /** 0 = only LOW risk, 1 = up to MEDIUM. */
  maxRisk: 0 | 1;
};

export const DEFAULT_DRAFT: SetupDraft = {
  vaultLabel: "Két của agent",
  agentName: "Agent của tôi",
  agentAddress: "",
  recipients: [{ name: "", address: "" }],
  dailyCap: 20,
  maxPerTx: 5,
  budget: 100,
  freeBelow: 1,
  maxRisk: 0,
};

const USDC_DECIMALS = 6;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type AgentCheck = { ok: true; address: Address } | { ok: false; message: string };

/** The agent wallet: a valid address that is not the owner's own wallet or the zero address. */
export function checkAgent(address: string, ownerWallets: readonly string[]): AgentCheck {
  const a = address.trim();
  if (!a) return { ok: false, message: "Nhập địa chỉ ví của agent, hoặc tạo một ví mới." };
  if (!isAddress(a)) return { ok: false, message: "Địa chỉ không hợp lệ: cần 0x và 40 ký tự 0–9, a–f." };
  if (/^0x0{40}$/i.test(a)) return { ok: false, message: "Không dùng địa chỉ 0x000…000." };
  if (ownerWallets.some((w) => same(w, a)))
    return {
      ok: false,
      message: "Đây là ví của bạn. Agent cần một ví riêng để khoá của bạn không nằm trong agent.",
    };
  return { ok: true, address: getAddress(a) };
}

export type RecipientIssue = { index: number; field: "name" | "address"; message: string };

/** Problems with the recipient list; empty when it can go on chain. Blank rows are ignored. */
/** Paying the owner's own wallet back is allowed; paying the agent itself is not useful and is refused. */
export function recipientIssues(list: readonly Recipient[], agent: string) {
  const issues: RecipientIssue[] = [];
  const seen = new Set<string>();
  let filled = 0;
  list.forEach((r, index) => {
    const address = r.address.trim();
    if (!address && !r.name.trim()) return;
    filled++;
    if (!r.name.trim())
      issues.push({ index, field: "name", message: "Đặt tên để sau này nhận ra người nhận." });
    if (!isAddress(address)) {
      issues.push({ index, field: "address", message: "Địa chỉ không hợp lệ." });
      return;
    }
    if (seen.has(address.toLowerCase()))
      issues.push({ index, field: "address", message: "Địa chỉ này đã có ở trên." });
    if (agent && same(address, agent))
      issues.push({
        index,
        field: "address",
        message: "Đây là ví của agent: agent không cần tự trả cho mình.",
      });
    seen.add(address.toLowerCase());
  });
  if (filled === 0)
    issues.push({
      index: 0,
      field: "address",
      message: "Cần ít nhất một người nhận: agent chỉ trả được cho họ.",
    });
  return issues;
}

export const filledRecipients = (list: readonly Recipient[]) =>
  list
    .filter((r) => r.address.trim() && isAddress(r.address.trim()))
    .map((r) => ({ name: r.name.trim(), address: getAddress(r.address.trim()) }));

export type LimitIssue = { field: "dailyCap" | "maxPerTx" | "budget" | "freeBelow"; message: string };
type Limits = Pick<SetupDraft, "dailyCap" | "maxPerTx" | "budget"> & { freeBelow?: number };

/** Limits the vault cannot work with: they block the step. */
export function limitIssues(d: Limits): LimitIssue[] {
  const out: LimitIssue[] = [];
  const bad = (n: number) => !Number.isFinite(n) || n < 0;
  if (bad(d.dailyCap) || d.dailyCap === 0)
    out.push({
      field: "dailyCap",
      message: "Hạn mức ngày phải lớn hơn 0, nếu không agent không chi được gì.",
    });
  if (bad(d.maxPerTx)) out.push({ field: "maxPerTx", message: "Không được âm." });
  if (bad(d.budget)) out.push({ field: "budget", message: "Không được âm." });
  if (d.freeBelow !== undefined && bad(d.freeBelow))
    out.push({ field: "freeBelow", message: "Không được âm." });
  return out;
}

/** Valid limits worth a second look: shown next to the field, never blocking. */
export function limitNotes(d: Limits): LimitIssue[] {
  const out: LimitIssue[] = [];
  if (d.dailyCap > 0 && d.maxPerTx > d.dailyCap)
    out.push({ field: "maxPerTx", message: "Lớn hơn hạn mức ngày nên mức ngày sẽ chặn trước." });
  if (d.budget > 0 && d.dailyCap > 0 && d.budget < d.dailyCap)
    out.push({
      field: "budget",
      message: "Nhỏ hơn hạn mức ngày: agent có thể dùng hết ngay trong ngày, rồi chờ bạn làm mới.",
    });
  if (d.freeBelow !== undefined && d.freeBelow > 0 && d.maxPerTx > 0 && d.freeBelow >= d.maxPerTx)
    out.push({
      field: "freeBelow",
      message: "Không nhỏ hơn mức mỗi giao dịch: mọi khoản trả cho người nhận sẽ không qua Guardian.",
    });
  return out;
}

const usdc = (n: number) => parseUnits(String(n), USDC_DECIMALS);

/** AgentVault.Config for VaultFactory.createVault (viem argument shape). */
export function vaultConfig(d: SetupDraft, usdcAddress: Address) {
  return {
    maxAgentRisk: d.maxRisk,
    tokens: [
      {
        token: usdcAddress,
        dailyCap: usdc(d.dailyCap),
        // Payments only: no approvals until the owner allows an app (Quy tắc → Ứng dụng).
        maxApproval: 0n,
        // Up to freeBelow to an allowed recipient: no Guardian, no Guardian fee (the caps still apply). Above
        // it, and for any approval or call to an app, the vault requires the Guardian's approval.
        verdictThreshold: usdc(d.freeBelow),
        maxPerTx: usdc(d.maxPerTx),
        budget: usdc(d.budget),
      },
    ],
    // AVAX is for the agent's gas only; the vault's own AVAX is not the agent's to spend.
    nativeDailyCap: 0n,
    nativeVerdictThreshold: 0n,
    nativeMaxPerTx: 0n,
    nativeBudget: 0n,
    targets: [],
    recipients: filledRecipients(d.recipients).map((r) => r.address),
  } as const;
}

const n = (x: number) => x.toLocaleString("vi-VN", { maximumFractionDigits: 6 });

/** The rules in words, one sentence each, as the owner reviews them before signing. */
export function rulesInWords(d: SetupDraft): string[] {
  const who = filledRecipients(d.recipients).map((r) => r.name || r.address);
  return [
    who.length === 0
      ? "Chưa có người nhận nào, nên agent chưa trả được cho ai."
      : `Chỉ trả tiền cho ${who.length === 1 ? who[0] : `${who.length} người nhận: ${who.join(", ")}`}.`,
    `Tối đa ${n(d.dailyCap)} USDC mỗi ngày${d.maxPerTx > 0 ? `, ${n(d.maxPerTx)} USDC mỗi giao dịch` : ""}.`,
    d.budget > 0
      ? `Tổng cộng tối đa ${n(d.budget)} USDC; hết thì agent dừng cho tới khi bạn làm mới.`
      : "Không giới hạn tổng, chỉ giới hạn theo ngày.",
    d.freeBelow > 0
      ? `Khoản tới ${n(d.freeBelow)} USDC két chi thẳng, không tốn phí Guardian; khoản lớn hơn phải được Guardian chấm rủi ro ${d.maxRisk === 0 ? "thấp" : "thấp hoặc trung bình"}.`
      : `Mọi khoản chi phải được Guardian chấm rủi ro ${d.maxRisk === 0 ? "thấp" : "thấp hoặc trung bình"}.`,
  ];
}
