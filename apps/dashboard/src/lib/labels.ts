// Vietnamese labels for risk levels, rules and vault errors. Risk is always shown with a word, not only a colour.
import type { RiskLevel, RuleId } from "@guardian402/shared";

export const RISK_LABEL: Record<RiskLevel, string> = { LOW: "THẤP", MEDIUM: "TRUNG BÌNH", HIGH: "CAO" };

export const RULE_LABEL: Record<RuleId, string> = {
  SIMULATION_FAILED: "Mô phỏng thất bại",
  POLICY_PRECHECK: "Vi phạm chính sách vault",
  UNLIMITED_APPROVAL: "Cấp quyền không giới hạn",
  UNKNOWN_CONTRACT: "Hợp đồng lạ",
  ADDRESS_POISONING: "Địa chỉ nhái",
  DRAIN_PATTERN: "Rút cạn số dư",
  ABNORMAL_SLIPPAGE: "Trượt giá bất thường",
  RECIPIENT_NOT_ALLOWLISTED: "Người nhận ngoài danh sách",
};

export const ruleLabel = (id: string) => RULE_LABEL[id as RuleId] ?? id;

/** `evidence.reason` of a POLICY_PRECHECK finding (apps/guardian/src/rules/checks.ts). */
export const PRECHECK_REASON_LABEL: Record<string, string> = {
  paused: "vault đang tạm dừng",
  "no-agent": "vault chưa có agent",
  "bad-batch": "lô lệnh phải có từ 1 tới 8 lệnh",
  "target-not-allowed": "hợp đồng đích không được phép",
  "selector-not-allowed": "hàm không được phép",
  "value-target-not-allowed": "không được gửi AVAX tới địa chỉ này",
  "recipient-not-allowed": "người nhận không được phép",
  "spender-not-allowed": "bên được cấp quyền không được phép",
  "approval-too-large": "cấp quyền vượt mức cho phép",
  "daily-cap-exceeded": "vượt hạn mức trong ngày",
};

const REVERT_LABEL: Record<string, string> = {
  RecipientNotAllowed: "người nhận không được phép",
  TargetNotAllowed: "hợp đồng đích không được phép",
  SelectorNotAllowed: "hàm không được phép",
  RiskTooHigh: "rủi ro vượt mức cho phép",
  InvalidVerdict: "verdict không khớp với lệnh",
  VerdictExpired: "verdict đã hết hạn",
  VerdictRequired: "thiếu verdict của Guardian",
  BadSignature: "chữ ký verdict sai",
  DailyCapExceeded: "vượt hạn mức trong ngày",
  ApprovalTooLarge: "cấp quyền vượt mức cho phép",
  NotAgent: "ví gửi không phải agent của vault",
  CallFailed: "một lệnh trong batch thất bại",
  Paused: "vault đang tạm dừng",
};

export const revertLabel = (name: string | undefined) =>
  name ? (REVERT_LABEL[name] ? `${REVERT_LABEL[name]} (${name})` : name) : "không rõ lý do";

export const ENDPOINT_LABEL: Record<string, string> = {
  check: "/v1/check",
  cosign: "/v1/cosign",
  demo: "/v1/demo/check",
};

export const SCENARIO_LABEL: Record<string, string> = {
  S0: "S0 · Chuyển 1.5 USDC an toàn",
  S1: "S1 · Swap bình thường",
  S2: "S2 · Rút cạn về ví kẻ tấn công",
  S3: "S3 · Cấp quyền cho địa chỉ nhái",
  S4: "S4 · Swap trượt giá",
  S5: "S5 · Dùng lại verdict",
  S6: "S6 · Chủ ví tạm dừng vault",
};
