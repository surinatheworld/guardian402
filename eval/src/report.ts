// eval/report.md (Vietnamese, with English rule ids). Synthetic cases; see the note at the top of the report.
import type { RiskLevel, RuleId } from "@guardian402/shared";
import type { Rates } from "./metrics.ts";

export type CaseResult = {
  id: string;
  label: "benign" | "malicious";
  category: string;
  description: string;
  risk: RiskLevel;
  score: number;
  rules: RuleId[];
  expectedRules: RuleId[];
  missingRules: RuleId[];
  simulationSuccess: boolean;
  explanationVi: string;
  latencyMs: number;
  note?: string;
};

export type ReportData = {
  cases: number;
  benign: number;
  malicious: number;
  forkBlock: string;
  blockedHigh: Rates;
  blockedMediumOrAbove: Rates;
  hitsPerRule: Record<RuleId, { benign: number; malicious: number }>;
  latencyMs: { p50: number; p95: number };
  simulationTimeoutMs: number;
  fingerprint: string;
  results: CaseResult[];
};

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const RISK_VI: Record<RiskLevel, string> = { LOW: "THẤP", MEDIUM: "TRUNG BÌNH", HIGH: "CAO" };
const esc = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

function matrix(title: string, r: Rates): string {
  return [
    `### ${title}`,
    "",
    "| | Bị chặn | Không bị chặn |",
    "| --- | --- | --- |",
    `| Độc hại (malicious) | ${r.tp} (TP) | ${r.fn} (FN) |`,
    `| Bình thường (benign) | ${r.fp} (FP) | ${r.tn} (TN) |`,
    "",
    `Precision ${pct(r.precision)} · Recall ${pct(r.recall)} · Tỉ lệ dương tính giả (FPR) ${pct(r.falsePositiveRate)}`,
    "",
  ].join("\n");
}

function misses(title: string, rows: CaseResult[]): string {
  if (!rows.length) return `### ${title}\n\nKhông có.\n`;
  return [
    `### ${title}`,
    "",
    ...rows.map((r) =>
      [
        `- **${r.id}** (${r.description}): rủi ro ${RISK_VI[r.risk]} ${r.score}/100, luật: ${r.rules.join(", ") || "không có"}.`,
        `  - Giải thích: ${r.note ?? "CHƯA CÓ GIẢI THÍCH: thêm trường `note` vào file case."}`,
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

export function writeReport(r: ReportData): string {
  const fn = r.results.filter((x) => x.label === "malicious" && x.risk !== "HIGH");
  const fp = r.results.filter((x) => x.label === "benign" && x.risk === "HIGH");
  const fpMedium = r.results.filter((x) => x.label === "benign" && x.risk === "MEDIUM");
  const missing = r.results.filter((x) => x.missingRules.length);
  return [
    "# Guardian402 — báo cáo eval",
    "",
    "> Các case là **dữ liệu tổng hợp do nhóm tự viết** (synthetic), chạy trên fork cục bộ của Fuji với mock oracle,",
    "> mock router và vault mới deploy. Đây không phải số liệu đo trên giao dịch thật của người dùng.",
    "",
    `Sinh bởi \`pnpm eval\`. ${r.cases} case (${r.benign} bình thường, ${r.malicious} độc hại). Fork từ block Fuji ${r.forkBlock}.`,
    `Pipeline giống \`/v1/check\` (không thu phí, giải thích bằng mẫu cố định), ngưỡng production (địa chỉ nhái 4/4, không phải DEMO 3/3).`,
    `Thời gian chờ mô phỏng trong eval là ${r.simulationTimeoutMs / 1000} s (production 800 ms) để độ trễ mạng không đổi kết quả giữa các lần chạy.`,
    "",
    `Dấu vân tay kết quả (không tính độ trễ): \`${r.fingerprint}\`. Hai lần chạy cho cùng dấu vân tay nghĩa là cùng mức rủi ro, điểm và luật cho mọi case.`,
    "",
    "## Tổng hợp",
    "",
    matrix("Chặn = rủi ro CAO (vault từ chối verdict khi maxAgentRisk = THẤP)", r.blockedHigh),
    matrix("Chặn = rủi ro TRUNG BÌNH trở lên", r.blockedMediumOrAbove),
    `Độ trễ pipeline: p50 ${r.latencyMs.p50} ms, p95 ${r.latencyMs.p95} ms (đo trên máy chạy eval, gồm đọc vault và mô phỏng trên fork).`,
    "",
    "## Thay đổi luật sau khi chạy eval",
    "",
    "Không có ngưỡng nào bị chỉnh. Ba lỗi logic được sửa, ghi lại số liệu trước và sau (cũng ghi trong docs/SPEC.md §16):",
    "",
    "- 2026-11-07, ABNORMAL_SLIPPAGE: khi một batch có hai swap qua cùng router tới cùng người nhận, luật cộng sản lượng của cả hai lúc xét từng swap, nên swap lệch giá bị che (case m20). Sửa: simulator gắn chỉ số lệnh cho mỗi Transfer, luật chỉ tính sản lượng của chính lệnh đó.",
    "  - Trước: chặn = CAO: TP 23, FP 0, TN 15, FN 2 · precision 100% · recall 92,0% · FPR 0%.",
    "  - Sau: chặn = CAO: TP 24, FP 0, TN 15, FN 1 · precision 100% · recall 96,0% · FPR 0%.",
    "- 2026-11-07, soát bảo mật P11 (phát hiện F1): RECIPIENT_NOT_ALLOWLISTED nay gắn cờ swap qua router đã biết có đầu ra (`to`) không về vault hoặc địa chỉ được phép (case m15); AgentVault thu hồi quyền chưa dùng hết ở cuối batch.",
    "  - Trước: chặn = CAO: TP 24, FP 0, TN 15, FN 1 · recall 96,0%.",
    "  - Sau: chặn = CAO: TP 25, FP 0, TN 15, FN 0 · precision 100% · recall 100% · FPR 0%. Kết quả này đo trên bộ case do chính nhóm viết, nên không có nghĩa là Guardian bắt được mọi tấn công thật.",
    "- 2026-11-08, UNKNOWN_CONTRACT: luật xét cả spender của lệnh thu hồi quyền (approve 0), nên việc thu hồi quyền cho một hợp đồng lạ bị đánh giá TRUNG BÌNH (case b11). Sửa: bỏ qua spender của lệnh approve 0.",
    "  - Trước: chặn = TRUNG BÌNH trở lên: FP 1 (b11).",
    "  - Sau: chặn = TRUNG BÌNH trở lên: FP 0. Chặn = CAO không đổi.",
    "",
    "## Số lần mỗi luật kích hoạt",
    "",
    "| Luật | Case độc hại | Case bình thường |",
    "| --- | --- | --- |",
    ...Object.entries(r.hitsPerRule).map(([id, h]) => `| ${id} | ${h.malicious} | ${h.benign} |`),
    "",
    "## Sai sót",
    "",
    misses("Âm tính giả (độc hại nhưng không bị chặn ở mức CAO)", fn),
    misses("Dương tính giả (bình thường nhưng bị chặn ở mức CAO)", fp),
    misses("Bình thường nhưng bị đánh giá TRUNG BÌNH", fpMedium),
    "### Luật mong đợi nhưng không kích hoạt",
    "",
    missing.length
      ? missing
          .map(
            (x) =>
              `- ${x.id}: thiếu ${x.missingRules.join(", ")} (đã kích hoạt: ${x.rules.join(", ") || "không có"})`,
          )
          .join("\n")
      : "Không có: mọi luật mong đợi đều kích hoạt.",
    "",
    "## Từng case",
    "",
    "| Case | Nhãn | Nhóm | Rủi ro | Điểm | Luật kích hoạt | Mô phỏng | ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...r.results.map(
      (x) =>
        `| ${x.id} | ${x.label} | ${x.category} | ${RISK_VI[x.risk]} | ${x.score} | ${x.rules.join(", ") || "—"} | ${x.simulationSuccess ? "ok" : "revert"} | ${x.latencyMs} |`,
    ),
    "",
    "## Lời giải thích của Guardian (mẫu cố định)",
    "",
    ...r.results.map((x) => `- **${x.id}**: ${esc(x.explanationVi)}`),
    "",
  ].join("\n");
}
