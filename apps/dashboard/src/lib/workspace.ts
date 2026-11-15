"use client";
// Browser side of the vault workspace API (/api/vaults/:vault/…, docs/API.md): types, labels and query hooks.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Address } from "viem";
import type { RiskLevel } from "@guardian402/shared";
import { accountApi } from "./account";
import type { TemplateId } from "./policy-catalog";
import type { PolicySpec } from "./policy-spec";

export type Agent = {
  id: number;
  name: string;
  description: string | null;
  address: Address;
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
  | "allow_selector"
  | "token_policy"
  | "native_policy"
  | "max_agent_risk";
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

export type PolicyVersion = {
  id: number;
  version: number;
  spec: PolicySpec;
  summary: string[];
  warnings: string[];
  note: string | null;
  createdAt: number;
};
export type Policy = {
  id: number;
  name: string;
  description: string | null;
  template: TemplateId;
  archived: boolean;
  updatedAt: number;
  latest: PolicyVersion;
  versionCount: number;
  assignments: {
    assignmentId: number;
    agentId: number;
    agentName: string;
    vault: Address;
    version: number;
  }[];
  versions?: PolicyVersion[];
};
export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
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
    // "" = not a linked vault (the demo vault): nothing to ask.
    enabled: Boolean(vault),
  });
export const useContacts = (vault: string, enabled = true) =>
  useQuery({
    queryKey: wsKey(vault, "contacts"),
    queryFn: () => wsApi<{ contacts: Contact[] }>(vault, "contacts"),
    enabled,
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
export const useAgentKeys = (vault: string, agentId: number) =>
  useQuery({
    queryKey: [...wsKey(vault, "keys"), agentId],
    queryFn: () => wsApi<{ keys: ApiKey[] }>(vault, `agents/${agentId}/keys`),
    enabled: Boolean(vault) && agentId > 0,
  });
export const useWorkspaceChecks = (vault: string) =>
  useQuery({
    queryKey: wsKey(vault, "checks"),
    queryFn: () => wsApi<{ checks: WorkspaceCheck[] }>(vault, "checks?limit=50"),
    retry: false,
  });
