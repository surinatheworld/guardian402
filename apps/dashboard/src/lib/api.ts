"use client";
// Browser-side reads of the Guardian API and the agent control API, through TanStack Query.
import { useQuery } from "@tanstack/react-query";
import { AGENT_URL, GUARDIAN_URL } from "./config";
import type { AgentHealth, Attempt, CheckListRow, GuardianHealth, Stats } from "./types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, body);
  return body as T;
}

const REFRESH_MS = 5_000;

export const useGuardianHealth = () =>
  useQuery({
    queryKey: ["guardian", "health"],
    queryFn: () => getJson<GuardianHealth>(`${GUARDIAN_URL}/v1/health`),
    refetchInterval: 15_000,
    retry: 1,
  });

export const useChecks = (limit = 50) =>
  useQuery({
    queryKey: ["guardian", "checks", limit],
    queryFn: () => getJson<{ checks: CheckListRow[] }>(`${GUARDIAN_URL}/v1/checks?limit=${limit}`),
    refetchInterval: REFRESH_MS,
  });

export const useStats = () =>
  useQuery({
    queryKey: ["guardian", "stats"],
    queryFn: () => getJson<Stats>(`${GUARDIAN_URL}/v1/stats`),
    refetchInterval: REFRESH_MS,
  });

/** The agent control API exists only in DEMO mode; "not running" is a normal state, not an error. */
export const useAgentHealth = () =>
  useQuery({
    queryKey: ["agent", "health"],
    queryFn: () => getJson<AgentHealth>(`${AGENT_URL}/health`),
    refetchInterval: 10_000,
    retry: false,
  });

export const useAttempts = (enabled: boolean) =>
  useQuery({
    queryKey: ["agent", "attempts"],
    queryFn: () => getJson<{ attempts: Attempt[] }>(`${AGENT_URL}/attempts?limit=100`),
    refetchInterval: REFRESH_MS,
    enabled,
  });

export function errorText(e: unknown): string {
  if (e instanceof HttpError) {
    // The Guardian's own state, not a judgement on the transaction; nothing was signed or charged.
    if (e.status === 503)
      return "Guardian đang bận hoặc chưa mô phỏng được giao dịch (HTTP 503, không tính phí). Thử lại sau vài giây.";
    if (e.status === 429) return "Gửi quá nhiều yêu cầu (HTTP 429). Chờ khoảng một phút rồi thử lại.";
    const b = e.body as { error?: string } | null;
    return `${e.message}${b?.error ? `: ${b.error}` : ""}`;
  }
  if (e instanceof TypeError) return "Không kết nối được (máy chủ chưa chạy, hoặc bị chặn CORS).";
  return e instanceof Error ? e.message : String(e);
}
