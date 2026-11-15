// Deterministic explanations (docs/SPEC.md §9): one sentence per rule that fired, plus one for LOW.
// Used when LLM_PROVIDER=none, and as the fallback for every LLM failure.
import type { Explanation, Finding, RiskLevel, RuleId } from "@guardian402/shared";
import { amount, clip, label, type Lang } from "./format.ts";
import type { ExplainInput, Explainer } from "./types.ts";

const HEADER: Record<RiskLevel, Record<Lang, string>> = {
  LOW: { vi: "Rủi ro THẤP.", en: "LOW risk." },
  MEDIUM: { vi: "Rủi ro TRUNG BÌNH.", en: "MEDIUM risk." },
  HIGH: { vi: "Rủi ro CAO.", en: "HIGH risk." },
};

const POLICY_REASON: Record<string, Record<Lang, string>> = {
  paused: { vi: "két đang khoá", en: "the vault is paused" },
  "no-agent": { vi: "agent đã bị thu hồi", en: "the agent was revoked" },
  "bad-batch": { vi: "số lệnh không hợp lệ", en: "invalid number of calls" },
  "target-not-allowed": { vi: "địa chỉ gọi không được phép", en: "target not allowed" },
  "selector-not-allowed": { vi: "hàm gọi không được phép", en: "function not allowed" },
  "recipient-not-allowed": { vi: "người nhận không được phép", en: "recipient not allowed" },
  "spender-not-allowed": { vi: "bên được cấp quyền không được phép", en: "spender not allowed" },
  "approval-too-large": { vi: "mức cấp quyền vượt giới hạn", en: "approval above the limit" },
  "value-target-not-allowed": {
    vi: "gửi AVAX tới địa chỉ không được phép",
    en: "AVAX sent to a target that is not allowed",
  },
  "daily-cap-exceeded": { vi: "vượt hạn mức chi trong ngày", en: "daily spending cap exceeded" },
  "tx-cap-exceeded": { vi: "vượt hạn mức mỗi giao dịch", en: "per-transaction cap exceeded" },
  "budget-exceeded": {
    vi: "vượt tổng ngân sách, cần chủ két làm mới",
    en: "total budget used up; the owner must reset it",
  },
};

type Sentence = (f: Finding, input: ExplainInput, lang: Lang) => string;

const SENTENCES: Record<RuleId, Sentence> = {
  SIMULATION_FAILED: (f, _i, lang) =>
    f.evidence.timedOut === true
      ? lang === "vi"
        ? "Không chạy thử kịp trong thời gian cho phép."
        : "The simulation did not finish in time."
      : lang === "vi"
        ? `Giao dịch bị lỗi khi chạy thử${f.evidence.failedCallIndex === undefined ? "" : ` (lệnh #${f.evidence.failedCallIndex})`}.`
        : `The transaction reverted in simulation${f.evidence.failedCallIndex === undefined ? "" : ` (call #${f.evidence.failedCallIndex})`}.`,
  POLICY_PRECHECK: (f, _i, lang) => {
    const r =
      POLICY_REASON[String(f.evidence.reason)]?.[lang] ??
      (lang === "vi" ? "vi phạm luật" : "policy violation");
    return lang === "vi"
      ? `Quy tắc của két sẽ từ chối giao dịch này: ${r}.`
      : `The vault policy would reject it: ${r}.`;
  },
  UNLIMITED_APPROVAL: (f, i, lang) => {
    const who = label(i, f.evidence.spender);
    if (f.evidence.approvalForAll === true) {
      return lang === "vi"
        ? `Cấp quyền dùng toàn bộ tài sản cho ${who}.`
        : `Grants ${who} control of every token in a collection.`;
    }
    const sym = i.tokens[String(f.evidence.token).toLowerCase()]?.symbol ?? "token";
    const amt =
      f.evidence.unlimited === true
        ? lang === "vi"
          ? `${sym} không giới hạn`
          : `an unlimited amount of ${sym}`
        : amount(i, f.evidence.token, f.evidence.amount, lang);
    return lang === "vi" ? `Cấp quyền tiêu ${amt} cho ${who}.` : `Approves ${who} to spend ${amt}.`;
  },
  UNKNOWN_CONTRACT: (f, i, lang) => {
    const base =
      lang === "vi"
        ? `${label(i, f.evidence.address)} là contract lạ, chưa có trong danh sách đã biết`
        : `${label(i, f.evidence.address)} is a contract that is not in the known list`;
    const facts: string[] = [];
    if (f.evidence.verified === false)
      facts.push(
        lang === "vi" ? "mã nguồn chưa verify trên Snowtrace" : "its source is not verified on Snowtrace",
      );
    if (f.evidence.verified === true)
      facts.push(lang === "vi" ? "mã nguồn đã verify trên Snowtrace" : "its source is verified on Snowtrace");
    if (typeof f.evidence.ageDays === "number")
      facts.push(
        lang === "vi" ? `tạo cách đây ${f.evidence.ageDays} ngày` : `created ${f.evidence.ageDays} days ago`,
      );
    return facts.length ? `${base} (${facts.join(", ")}).` : `${base}.`;
  },
  ADDRESS_POISONING: (f, i, lang) =>
    lang === "vi"
      ? `${label(i, f.evidence.address)} là địa chỉ nhái, trông giống ${label(i, f.evidence.looksLike)}.`
      : `${label(i, f.evidence.address)} is a lookalike of ${label(i, f.evidence.looksLike)}.`,
  DRAIN_PATTERN: (f, i, lang) =>
    lang === "vi"
      ? `Chuyển ${String(f.evidence.percent).replace(".", ",")}% số dư (${amount(i, f.evidence.token, f.evidence.outflow, lang)}) ra khỏi két.`
      : `Moves ${f.evidence.percent}% of the balance (${amount(i, f.evidence.token, f.evidence.outflow, lang)}) out of the vault.`,
  ABNORMAL_SLIPPAGE: (f, _i, lang) => {
    const pct = (Number(f.evidence.slippageBps) / 100).toString();
    return lang === "vi"
      ? `Hoán đổi nhận ít hơn giá tham chiếu ${pct.replace(".", ",")}%.`
      : `The swap returns ${pct}% less than the reference price.`;
  },
  RECIPIENT_NOT_ALLOWLISTED: (f, i, lang) =>
    f.evidence.via === "swap-output"
      ? lang === "vi"
        ? `Token nhận được từ hoán đổi được gửi tới ${label(i, f.evidence.recipient)} thay vì két, ngoài danh sách cho phép.`
        : `The swap output is sent to ${label(i, f.evidence.recipient)} instead of the vault, outside the allowlist.`
      : lang === "vi"
        ? `${amount(i, f.evidence.token, f.evidence.amount, lang)} rời két tới ${label(i, f.evidence.recipient)}, ngoài danh sách cho phép.`
        : `${amount(i, f.evidence.token, f.evidence.amount, lang)} leaves the vault to ${label(i, f.evidence.recipient)}, outside the allowlist.`,
  UNPROTECTED_SWAP: (f, _i, lang) => {
    if (f.evidence.minOut === "0") {
      return lang === "vi"
        ? "Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận."
        : "The swap sets no minimum output (minOut = 0): if the price moves before it really runs, the vault still takes it.";
    }
    const pct = (Number(f.evidence.gapBps) / 100).toString();
    return lang === "vi"
      ? `Mức nhận tối thiểu thấp hơn kết quả chạy thử ${pct.replace(".", ",")}%: nếu giá xấu đi trước khi giao dịch chạy thật, két vẫn phải nhận.`
      : `The minimum output is ${pct}% below the simulated output: if the price gets worse before it really runs, the vault still takes it.`;
  },
};

/** "Vault: -2 USDC, +0,079 mWAVAX." from the token and AVAX deltas. */
function changes(input: ExplainInput, lang: Lang): string {
  const parts = input.diff.tokenDeltas.map((d) => {
    const a = amount(input, d.token, d.delta, lang);
    return a.startsWith("-") ? a : `+${a}`;
  });
  if (input.diff.nativeDelta !== "0") {
    const a = amount(input, "0x0000000000000000000000000000000000000000", input.diff.nativeDelta, lang);
    parts.push(a.startsWith("-") ? a : `+${a}`);
  }
  if (parts.length === 0) return lang === "vi" ? "Số dư két không đổi." : "Vault balances do not change.";
  return `${lang === "vi" ? "Két" : "Vault"}: ${parts.join(", ")}.`;
}

function write(input: ExplainInput, lang: Lang): string {
  if (input.risk === "LOW") {
    const tail = lang === "vi" ? "Không thấy dấu hiệu bất thường." : "No warning signs found.";
    return clip(`${HEADER.LOW[lang]} ${changes(input, lang)} ${tail}`);
  }
  // Highest severity first, one sentence per rule, at most three.
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const seen = new Set<string>();
  const lines = [...input.findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .filter((f) => (seen.has(f.ruleId) ? false : (seen.add(f.ruleId), true)))
    .slice(0, 3)
    .map((f) => SENTENCES[f.ruleId](f, input, lang));
  return clip([HEADER[input.risk][lang], ...lines, changes(input, lang)].join(" "));
}

export class TemplateExplainer implements Explainer {
  async explain(input: ExplainInput): Promise<Explanation> {
    return { vi: write(input, "vi"), en: write(input, "en"), source: "template" };
  }
}
