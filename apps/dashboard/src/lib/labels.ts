// The dashboard's one vocabulary (Phase 1 audit, "Từ điển thuật ngữ"). Every screen names a thing with the words
// here; protocol terms (verdict, batch, endpoint paths, rule ids, revert names) appear only in "Chi tiết kỹ thuật".
// Risk is always a word plus a colour and a mark, never a colour alone.
import type { RiskLevel, RuleId } from "@guardian402/shared";

/** Lower-case risk word, for use inside a sentence: "rủi ro cao". */
export const RISK_LABEL: Record<RiskLevel, string> = { LOW: "thấp", MEDIUM: "trung bình", HIGH: "cao" };
/** Stand-alone risk label: "Rủi ro cao". */
export const RISK_TITLE: Record<RiskLevel, string> = {
  LOW: "Rủi ro thấp",
  MEDIUM: "Rủi ro trung bình",
  HIGH: "Rủi ro cao",
};
export const RISK_BY_CODE = ["LOW", "MEDIUM", "HIGH"] as const;

/** What the vault accepts at most (AgentVault.maxAgentRisk), as the owner reads it. */
export const MAX_RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Chỉ giao dịch rủi ro thấp",
  MEDIUM: "Đến rủi ro trung bình",
  HIGH: "Cả giao dịch rủi ro cao",
};

export const RULE_LABEL: Record<RuleId, string> = {
  SIMULATION_FAILED: "Chạy thử thất bại",
  POLICY_PRECHECK: "Vi phạm quy tắc của két",
  UNLIMITED_APPROVAL: "Cấp quyền rút không giới hạn",
  UNKNOWN_CONTRACT: "Ứng dụng lạ",
  ADDRESS_POISONING: "Địa chỉ nhái",
  DRAIN_PATTERN: "Rút gần hết số dư",
  ABNORMAL_SLIPPAGE: "Giá swap lệch bất thường",
  RECIPIENT_NOT_ALLOWLISTED: "Người nhận ngoài danh sách tin cậy",
  UNPROTECTED_SWAP: "Swap không đặt mức nhận tối thiểu",
};

export const ruleLabel = (id: string) => RULE_LABEL[id as RuleId] ?? id;

/** `evidence.reason` of a POLICY_PRECHECK finding (apps/guardian/src/rules/checks.ts). */
export const PRECHECK_REASON_LABEL: Record<string, string> = {
  paused: "két đang khoá",
  "no-agent": "két chưa có agent",
  "bad-batch": "giao dịch phải có từ 1 tới 8 bước",
  "target-not-allowed": "ứng dụng không được phép",
  "selector-not-allowed": "thao tác không được phép trên ứng dụng này",
  "value-target-not-allowed": "không được gửi AVAX tới địa chỉ này",
  "recipient-not-allowed": "người nhận không nằm trong danh sách tin cậy",
  "spender-not-allowed": "bên được cấp quyền rút không được phép",
  "approval-too-large": "quyền rút vượt mức cho phép",
  "daily-cap-exceeded": "vượt hạn mức mỗi ngày",
  "tx-cap-exceeded": "vượt hạn mức mỗi giao dịch",
  "budget-exceeded": "đã dùng hết tổng ngân sách, chờ chủ két làm mới",
};

const REVERT_LABEL: Record<string, string> = {
  RecipientNotAllowed: "người nhận không nằm trong danh sách tin cậy",
  TargetNotAllowed: "ứng dụng không được phép",
  SelectorNotAllowed: "thao tác không được phép",
  RiskTooHigh: "rủi ro vượt mức két chấp nhận",
  InvalidVerdict: "phê duyệt của Guardian không khớp với giao dịch",
  VerdictExpired: "phê duyệt của Guardian đã hết hạn",
  VerdictRequired: "thiếu phê duyệt của Guardian",
  BadSignature: "chữ ký phê duyệt sai",
  DailyCapExceeded: "vượt hạn mức mỗi ngày",
  TxCapExceeded: "vượt hạn mức mỗi giao dịch",
  BudgetExceeded: "đã dùng hết tổng ngân sách, chờ chủ két làm mới",
  ApprovalTooLarge: "quyền rút vượt mức cho phép",
  NotAgent: "ví gửi không phải agent của két",
  CallFailed: "một bước trong giao dịch thất bại",
  Paused: "két đang khoá",
};

/** Why the vault reverted, in words. The raw error name stays in the technical details. */
export const revertLabel = (name: string | undefined) =>
  name ? (REVERT_LABEL[name] ?? name) : "không rõ lý do";

/** Guardian endpoints by what they do for the owner (the paths are technical details). */
export const ENDPOINT_LABEL: Record<string, string> = {
  check: "Kiểm tra",
  cosign: "Kiểm tra và duyệt",
  demo: "Chạy thử",
};
export const ENDPOINT_PATH: Record<string, string> = {
  check: "/v1/check",
  cosign: "/v1/cosign",
  demo: "/v1/demo/check",
};

/** Names of the dashboard's five destinations, also used for page titles. */
export const PAGE = {
  home: "Tổng quan",
  activity: "Hoạt động",
  trial: "Chạy thử",
  walletCheck: "Kiểm tra ví",
  rules: "Quy tắc chi tiêu",
  agents: "Agent",
  account: "Tài khoản",
  about: "Về Guardian",
} as const;

/** Display names of the DEMO deployment (MockRouter, mWAVAX) in the owner's words. */
export const DEMO_NAME = {
  router: "Sàn swap thử nghiệm",
  oracle: "Bảng giá thử nghiệm",
  wavax: "WAVAX thử nghiệm",
} as const;

/** A finding in words; a vault-rule finding names the rule it breaks ("… : vượt hạn mức mỗi ngày"). */
export const findingLabel = (f: { ruleId: string; evidence: Record<string, unknown> }) => {
  const reason = f.ruleId === "POLICY_PRECHECK" ? String(f.evidence.reason ?? "") : "";
  return reason ? `${ruleLabel(f.ruleId)}: ${PRECHECK_REASON_LABEL[reason] ?? reason}` : ruleLabel(f.ruleId);
};
