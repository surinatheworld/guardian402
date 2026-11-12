// Glue between route handlers and the account rules: the service singleton, the session cookie, same-origin
// checks for every state-changing request, a small login rate limiter, and JSON errors.
import { createPublicClient, type Address } from "viem";
import { agentVaultAbi, FUJI_CHAIN_ID, fujiChain, rpcTransport } from "@guardian402/shared";
import { deployment, RPC_URL } from "@/lib/config";
import { AccountError, Accounts, isAccountError, SESSION_TTL_MS, type SessionMethod } from "./accounts";
import { getDb } from "./db";
import { AgentApi, type AgentPrincipal } from "./agent-api";
import { Policies } from "./policies";
import { chainPort, guardianPort } from "./ports";
import { Workspace } from "./workspace";

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

const gw = globalThis as { __g402Workspace?: Workspace };
export function workspace(): Workspace {
  gw.__g402Workspace ??= new Workspace(getDb(), {
    chain: chainPort,
    guardian: guardianPort,
    chainId: FUJI_CHAIN_ID,
    capToken: deployment.usdc,
    known: [
      { name: "Sàn swap thử nghiệm", address: deployment.router },
      { name: "USDC", address: deployment.usdc },
      { name: "WAVAX thử nghiệm", address: deployment.mWAVAX },
      { name: "Bảng giá thử nghiệm", address: deployment.oracle },
    ],
  });
  return gw.__g402Workspace;
}

const gp = globalThis as { __g402Policies?: Policies; __g402AgentApi?: AgentApi };
export function policies(): Policies {
  gp.__g402Policies ??= new Policies(getDb(), { chain: chainPort, workspace: workspace() });
  return gp.__g402Policies;
}
export function agentApi(): AgentApi {
  gp.__g402AgentApi ??= new AgentApi(getDb(), {
    chain: chainPort,
    guardian: guardianPort,
    policies: policies(),
  });
  return gp.__g402AgentApi;
}

type VaultParams = { params: Promise<Record<string, string>> };

/**
 * Route helper for /api/vaults/[vault]/…: signed-in user, same origin for writes, the vault must be linked to
 * the user. `fn` gets the workspace, the vault context and the other route params.
 */
export function vaultRoute(
  fn: (
    ws: Workspace,
    v: ReturnType<Workspace["vault"]>,
    params: Record<string, string>,
    req: Request,
  ) => Promise<unknown> | unknown,
  status = 200,
) {
  return (req: Request, ctx: VaultParams) =>
    handle(async () => {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const { userId } = requireUser(req);
      const params = await ctx.params;
      const ws = workspace();
      const v = ws.vault(userId, params.vault ?? "");
      const body = await fn(ws, v, params, req);
      return Response.json(body ?? { ok: true }, { status, headers: { "Cache-Control": "no-store" } });
    });
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
  const secure = requestOrigin(req).https ? "; Secure" : "";
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

const firstValue = (req: Request, name: string) => req.headers.get(name)?.split(",")[0]?.trim() || null;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin the browser used. Behind a TLS-terminating proxy (a public tunnel) the dashboard itself is reached
 * over plain http, so the scheme and host come from X-Forwarded-Proto / X-Forwarded-Host when present: without
 * that, the session cookie would lose `Secure` there. A page on another site cannot set these headers on a
 * request that carries the user's cookies (a custom header needs a CORS preflight, which nothing here grants).
 *
 * `DASHBOARD_PUBLIC_ORIGINS` (comma-separated, e.g. https://demo.example.com) pins the accepted public origins:
 * a client that writes its own Host or X-Forwarded-Host then cannot make the dashboard accept a Sign-In with
 * Ethereum message that was signed for another site. This machine's own origins are always accepted.
 */
export function requestOrigin(req: Request): { origin: string; host: string; https: boolean } {
  const url = new URL(req.url);
  const proto = firstValue(req, "x-forwarded-proto");
  const https = proto === "https" || (proto !== "http" && url.protocol === "https:");
  const host = firstValue(req, "x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const origin = `${https ? "https" : "http"}://${host}`;
  const pinned = (process.env.DASHBOARD_PUBLIC_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (pinned.length > 0 && !pinned.includes(origin)) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      /* not a host: refused below */
    }
    if (!LOCAL_HOSTNAMES.has(hostname))
      throw new AccountError(403, "bad_origin", "Yêu cầu không đến từ dashboard này.");
  }
  return { origin, host, https };
}

/** Browsers send Origin on every cross-site POST/PATCH/DELETE; anything but our own origin is refused (CSRF). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== requestOrigin(req).origin)
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

/** Signed-in route that is not scoped to a vault (the user's policy library). */
export function userRoute(
  fn: (userId: string, params: Record<string, string>, req: Request) => Promise<unknown> | unknown,
  status = 200,
) {
  return (req: Request, ctx: VaultParams) =>
    handle(async () => {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const { userId } = requireUser(req);
      const body = await fn(userId, await ctx.params, req);
      return Response.json(body ?? { ok: true }, { status, headers: { "Cache-Control": "no-store" } });
    });
}

/**
 * Route helper for the agent API: `Authorization: Bearer g402_…`, no cookies, no CORS (server-to-server).
 * `fn` may return a Response (the Guardian proxy) or a JSON body.
 */
export function agentRoute(
  fn: (p: AgentPrincipal, params: Record<string, string>, req: Request) => Promise<unknown> | unknown,
) {
  return (req: Request, ctx: VaultParams) =>
    handle(async () => {
      const p = agentApi().authenticate(req.headers.get("authorization"));
      agentLimiter.take(`key:${p.keyId}`);
      const out = await fn(p, await ctx.params, req);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
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
      this.#hits.delete(key);
      this.#hits.set(key, recent);
      throw new AccountError(429, "rate_limited", "Thử quá nhiều lần. Đợi vài phút rồi thử lại.");
    }
    recent.push(now);
    // Re-insert so the map stays ordered by last use.
    this.#hits.delete(key);
    this.#hits.set(key, recent);
    // Too many keys: drop expired ones, then the least recently used. Never everything at once: a flood of
    // new keys must not reset the limits of the keys that matter.
    if (this.#hits.size > RateLimiter.MAX_KEYS) {
      for (const [k, hits] of this.#hits)
        if (!hits.some((t) => now - t < this.windowMs)) this.#hits.delete(k);
      for (const k of this.#hits.keys()) {
        if (this.#hits.size <= RateLimiter.MAX_KEYS) break;
        this.#hits.delete(k);
      }
    }
  }
  static readonly MAX_KEYS = 10_000;
}

const WINDOW_MS = 15 * 60 * 1000;

/**
 * The client as the nearest proxy saw it: the last X-Forwarded-For entry. A proxy (a public tunnel) appends the
 * address it accepted the connection from; everything before that is the caller's own text and can be made up.
 * With no proxy in front the whole header is the caller's, so no limit rests on this key alone: each one below
 * also has a cap that does not depend on it.
 */
export function clientKey(req: Request): string {
  const last = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return last ? last.slice(0, 64) : "local";
}

const perClient = new RateLimiter(10, WINDOW_MS);
const loginPerClient = new RateLimiter(30, WINDOW_MS);
const loginPerEmail = new RateLimiter(50, WINDOW_MS);
// Every registration costs one scrypt hash (32 MiB): bounded for all callers together.
const registerOverall = new RateLimiter(60, WINDOW_MS);
const siweOverall = new RateLimiter(600, WINDOW_MS);

/** POST /api/auth/register. */
export function limitRegister(req: Request) {
  perClient.take(`register:${clientKey(req)}`);
  registerOverall.take("register");
}

/**
 * POST /api/auth/login. Ten tries per email from one client; someone else's wrong guesses no longer lock the
 * owner of the email out after ten requests. The per-email cap (all clients together) still bounds guessing
 * from many addresses.
 */
export function limitLogin(req: Request, email: string) {
  const client = clientKey(req);
  perClient.take(`login:${email}:${client}`);
  loginPerClient.take(`login:${client}`);
  loginPerEmail.take(`login:${email}`);
}

/** POST /api/auth/siwe/verify. */
export function limitSiwe(req: Request) {
  perClient.take(`siwe:${clientKey(req)}`);
  siweOverall.take("siwe");
}
/** Agent API calls per key (the Guardian has its own limits; this keeps a leaked key from hammering it). */
const agentLimiter = new RateLimiter(120, 60_000);

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
