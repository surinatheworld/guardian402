"use client";
// Browser side of the accounts API (/api/auth/*, /api/account/*, same origin, session cookie).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { Me } from "@/server/accounts";

export type MeResponse = Me & { session: { method: "password" | "siwe" } };

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function accountApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok)
    throw new AccountApiError(
      res.status,
      json?.error ?? "http",
      json?.message ?? `Lỗi máy chủ (HTTP ${res.status}).`,
    );
  return json as T;
}

export const ME_KEY = ["account", "me"] as const;

/** The signed-in account, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await accountApi<MeResponse>("/api/auth/me");
      } catch (e) {
        if (e instanceof AccountApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}

/**
 * Sign-In with Ethereum: fetch a nonce, build the EIP-4361 message for this site, have the wallet sign it
 * (free, no transaction), and send it to the server. Signed in already → the wallet is linked instead.
 */
export async function signInWithWallet(
  address: Address,
  sign: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<{ outcome: "signed_in" | "linked" | "created" }> {
  const { nonce, chainId } = await accountApi<{ nonce: string; chainId: number }>(
    "/api/auth/siwe/nonce",
    "POST",
  );
  const issuedAt = new Date();
  const message = createSiweMessage({
    domain: window.location.host,
    address,
    statement: "Đăng nhập Guardian402 bằng ví này. Ký thông điệp không tốn phí và không gửi giao dịch nào.",
    uri: window.location.origin,
    version: "1",
    chainId,
    nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 5 * 60_000),
  });
  const signature = await sign({ message });
  return accountApi("/api/auth/siwe/verify", "POST", { message, signature });
}

/** Every audit event the server writes (accounts, workspace, rule sets, agent API), in words. */
export const EVENT_LABEL: Record<string, string> = {
  register: "Tạo tài khoản",
  login: "Đăng nhập",
  login_failed: "Đăng nhập sai mật khẩu",
  password_added: "Thêm email và mật khẩu",
  password_changed: "Đổi mật khẩu",
  wallet_linked: "Liên kết ví",
  wallet_unlinked: "Gỡ ví",
  vault_linked: "Liên kết két",
  vault_unlinked: "Gỡ két",
  vault_lost: "Két đã chuyển chủ trên chain",
  agent_added: "Thêm agent",
  agent_removed: "Xoá agent",
  api_key_created: "Tạo khoá API",
  api_key_revoked: "Thu hồi khoá API",
  contact_added: "Thêm người nhận vào danh bạ",
  contact_added_lookalike: "Thêm người nhận trông giống địa chỉ khác",
  policy_created: "Tạo bộ quy tắc",
  policy_versioned: "Sửa bộ quy tắc",
  policy_archived: "Lưu trữ bộ quy tắc",
  policy_assigned: "Gán bộ quy tắc cho agent",
  policy_unassigned: "Bỏ gán bộ quy tắc",
  policy_apply_drafted: "Soạn thay đổi để áp dụng bộ quy tắc",
  policy_drafted: "Soạn thay đổi cho két",
  policy_submitted: "Gửi thay đổi lên chain",
  policy_confirmed: "Thay đổi đã áp dụng trên két",
  policy_failed: "Thay đổi thất bại trên chain",
  policy_cancelled: "Huỷ thay đổi",
  check_reviewed: "Đánh giá một lần kiểm tra",
};
export const eventLabel = (event: string) => EVENT_LABEL[event] ?? "Thay đổi khác";
