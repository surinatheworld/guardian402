// Glue between route handlers and the account rules: the service singleton, the session cookie, same-origin
// checks for every state-changing request, a small login rate limiter, and JSON errors.
import { createPublicClient, type Address } from "viem";
import { agentVaultAbi, FUJI_CHAIN_ID, fujiChain, rpcTransport } from "@guardian402/shared";
import { RPC_URL } from "@/lib/config";
import { AccountError, Accounts, isAccountError, SESSION_TTL_MS, type SessionMethod } from "./accounts";
import { getDb } from "./db";

export const SESSION_COOKIE = "g402_session";

const chain = createPublicClient({ chain: fujiChain, transport: rpcTransport(RPC_URL) });

const CHAIN_TIMEOUT_MS = 10_000;

/**
 * owner() of an AgentVault, or null when the address is not one (no code, or owner()/guardian() revert).
 * An unreachable or rate-limited RPC is a 503, not "not a vault".
 */
export async function readVaultOwner(vault: Address): Promise<Address | null> {
  const unavailable = () =>
    new AccountError(
      503,
      "chain_unavailable",
      "Không đọc được chain lúc này (RPC bận). Thử lại sau ít phút.",
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(unavailable()), CHAIN_TIMEOUT_MS);
  });
  try {
    const code = await Promise.race([chain.getCode({ address: vault }), timeout]);
    if (!code || code === "0x") return null;
    const [owner] = await Promise.race([
      Promise.all([
        chain.readContract({ address: vault, abi: agentVaultAbi, functionName: "owner" }),
        chain.readContract({ address: vault, abi: agentVaultAbi, functionName: "guardian" }),
      ]),
      timeout,
    ]);
    return owner;
  } catch (e) {
    if (isAccountError(e)) throw e;
    // A contract that is not an AgentVault reverts or returns nothing for owner()/guardian().
    const name = e instanceof Error ? e.name : "";
    if (name === "ContractFunctionExecutionError" || name === "ContractFunctionZeroDataError") return null;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

const g = globalThis as { __g402Accounts?: Accounts };
export function accounts(): Accounts {
  g.__g402Accounts ??= new Accounts(getDb(), { chainId: FUJI_CHAIN_ID, readVaultOwner });
  return g.__g402Accounts;
}

// ------------------------------------------------------------------ cookies

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionToken(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

function cookie(req: Request, value: string, maxAgeSeconds: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** JSON response that also signs the user in (new session cookie). */
export function withSession(
  req: Request,
  body: unknown,
  userId: string,
  method: SessionMethod,
  walletId: number | null,
  status = 200,
): Response {
  const svc = accounts();
  svc.destroySession(sessionToken(req)); // a new sign-in never reuses an old session id
  const token = svc.createSession(userId, method, walletId, req.headers.get("user-agent"));
  return Response.json(body, {
    status,
    headers: {
      "Set-Cookie": cookie(req, token, Math.floor(SESSION_TTL_MS / 1000)),
      "Cache-Control": "no-store",
    },
  });
}

export function clearSession(req: Request, body: unknown = { ok: true }): Response {
  accounts().destroySession(sessionToken(req));
  return Response.json(body, { headers: { "Set-Cookie": cookie(req, "", 0), "Cache-Control": "no-store" } });
}

export function currentUser(req: Request) {
  return accounts().sessionUser(sessionToken(req));
}

// ------------------------------------------------------------------ request checks

/** Browsers send Origin on every cross-site POST/PATCH/DELETE; anything but our own origin is refused (CSRF). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin)
    throw new AccountError(403, "bad_origin", "Yêu cầu không đến từ dashboard này.");
}

export function requireUser(req: Request) {
  const s = currentUser(req);
  if (!s) throw new AccountError(401, "signed_out", "Bạn cần đăng nhập.");
  return s;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > 16_384)
    throw new AccountError(413, "too_large", "Yêu cầu quá lớn.");
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new AccountError(400, "bad_json", "Dữ liệu gửi lên không hợp lệ.");
}

/** At most `max` attempts per key in `windowMs` (in memory: one dashboard process). */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}
  take(key: string, now = Date.now()) {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.#hits.set(key, recent);
      throw new AccountError(429, "rate_limited", "Thử quá nhiều lần. Đợi vài phút rồi thử lại.");
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) this.#hits.clear();
  }
}
export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

/** Runs a handler and turns AccountError into a JSON error response. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (isAccountError(e)) return Response.json({ error: e.code, message: e.message }, { status: e.status });
    console.error("[accounts]", e instanceof Error ? e.message : e);
    return Response.json({ error: "internal", message: "Lỗi máy chủ." }, { status: 500 });
  }
}
