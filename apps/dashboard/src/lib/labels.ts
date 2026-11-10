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
  S0: "S0 · Chuyển 1 USDC an toàn",
  S1: "S1 · Swap bình thường",
  S2: "S2 · Rút cạn về ví kẻ tấn công",
  S3: "S3 · Cấp quyền cho địa chỉ nhái",
  S4: "S4 · Swap trượt giá",
  S5: "S5 · Dùng lại verdict",
  S6: "S6 · Chủ ví tạm dừng vault",
};
