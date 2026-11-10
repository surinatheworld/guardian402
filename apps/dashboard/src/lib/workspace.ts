"use client";
// Browser side of the vault workspace API (/api/vaults/:vault/…, docs/API.md): types, labels and query hooks.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Address, Hex } from "viem";
import type { RiskLevel } from "@guardian402/shared";
import { accountApi } from "./account";

export type Agent = {
  id: number;
  name: string;
  description: string | null;
  address: Address;
  strategy: "dca" | "payments" | "custom";
  status: "active" | "paused" | "retired";
  isOnChainAgent: boolean;
  createdAt: number;
};
export type Contact = {
  id: number;
  name: string;
  address: Address;
  kind: "recipient" | "router" | "treasury" | "other";
  note: string | null;
  allowlisted: { recipient: boolean; target: boolean };
};
export type PolicyKind =
  | "pause"
  | "unpause"
  | "set_agent"
  | "revoke_agent"
  | "allow_recipient"
  | "allow_target"
  | "token_policy"
  | "native_policy"
  | "max_agent_risk";
export type PolicyChange = {
  id: number;
  kind: PolicyKind;
  params: Record<string, unknown>;
  status: "draft" | "submitted" | "confirmed" | "failed" | "cancelled";
  note: string | null;
  txHash: Hex | null;
  transaction: { to: Address; data: Hex; value: string };
  warnings?: string[];
  createdAt: number;
  confirmedAt: number | null;
};
export type AlertRule = {
  id: number;
  name: string;
  kind: "risk" | "rule" | "cap_usage";
  minRisk: "MEDIUM" | "HIGH" | null;
  ruleId: string | null;
  capPercent: number | null;
  enabled: boolean;
};
export type Notification = {
  id: number;
  title: string;
  body: string;
  checkId: string | null;
  createdAt: number;
  readAt: number | null;
};
export type ReviewStatus = "reviewed" | "false_positive" | "escalated";
export type WorkspaceCheck = {
  checkId: string;
  createdAt: number;
  endpoint: string;
  risk: RiskLevel;
  score: number;
  ruleIds: string[];
  explanation: { vi: string; en: string; source: string } | null;
  review: { status: ReviewStatus; note: string | null; updatedAt: number } | null;
};

export const STRATEGY_LABEL: Record<Agent["strategy"], string> = {
  dca: "Mua định kỳ (DCA)",
  payments: "Thanh toán",
  custom: "Tuỳ chỉnh",
};
export const AGENT_STATUS_LABEL: Record<Agent["status"], string> = {
  active: "Đang hoạt động",
  paused: "Tạm nghỉ",
  retired: "Ngừng dùng",
};
export const CONTACT_KIND_LABEL: Record<Contact["kind"], string> = {
  recipient: "Người nhận",
  router: "Sàn / router",
  treasury: "Kho bạc",
  other: "Khác",
};
export const POLICY_KIND_LABEL: Record<PolicyKind, string> = {
  pause: "Tạm dừng vault",
  unpause: "Mở lại vault",
  set_agent: "Đặt agent",
  revoke_agent: "Thu hồi agent",
  allow_recipient: "Danh sách người nhận",
  allow_target: "Danh sách contract được gọi",
  token_policy: "Hạn mức USDC",
  native_policy: "Hạn mức AVAX",
  max_agent_risk: "Mức rủi ro tối đa cho agent",
};
export const POLICY_STATUS_LABEL: Record<PolicyChange["status"], string> = {
  draft: "Bản nháp: chờ ký trong ví",
  submitted: "Đã gửi: chờ xác nhận trên chain",
  confirmed: "Đã xác nhận trên chain",
  failed: "Giao dịch thất bại trên chain",
  cancelled: "Đã huỷ",
};
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  reviewed: "Đã xem",
  false_positive: "Báo động nhầm",
  escalated: "Cần xử lý",
};

export const wsPath = (vault: string, path: string) => `/api/vaults/${vault}/${path}`;
export const wsApi = <T>(vault: string, path: string, method = "GET", body?: unknown) =>
  accountApi<T>(wsPath(vault, path), method, body);

export const wsKey = (vault: string, part: string) => ["workspace", vault.toLowerCase(), part] as const;

export function useInvalidate(vault: string) {
  const qc = useQueryClient();
  return useCallback(
    (...parts: string[]) =>
      Promise.all(parts.map((p) => qc.invalidateQueries({ queryKey: wsKey(vault, p) }))),
    [qc, vault],
  );
}

export const useAgents = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "agents"),
    queryFn: () => wsApi<{ onChainAgent: Address | null; agents: Agent[] }>(vault, "agents"),
  });
export const useContacts = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "contacts"),
    queryFn: () => wsApi<{ contacts: Contact[] }>(vault, "contacts"),
  });
export const usePolicyChanges = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "policy"),
    queryFn: () => wsApi<{ changes: PolicyChange[] }>(vault, "policy-changes"),
  });
export const useAlertRules = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "rules"),
    queryFn: () => wsApi<{ rules: AlertRule[] }>(vault, "alert-rules"),
  });
export const useNotifications = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "notifications"),
    queryFn: () =>
      wsApi<{
        sync: { created: number; guardian: boolean; chain: boolean };
        unread: number;
        notifications: Notification[];
      }>(vault, "notifications"),
    refetchInterval: 30_000,
  });
export const useWorkspaceChecks = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "checks"),
    queryFn: () => wsApi<{ checks: WorkspaceCheck[] }>(vault, "checks?limit=50"),
    retry: false,
  });
