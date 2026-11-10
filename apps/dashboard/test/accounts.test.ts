// Account rules (web2 + web3) on an in-memory SQLite database, and the auth route handlers end to end.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, Accounts, NONCE_TTL_MS, SESSION_TTL_MS } from "../src/server/accounts";
import { openDb, type Db } from "../src/server/db";
import { RateLimiter } from "../src/server/http";

const CHAIN = 43113;
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

let db: Db;
let now: number;
let owners: Map<string, Address>;
let svc: Accounts;
beforeEach(() => {
  db = openDb(":memory:");
  now = Date.UTC(2026, 10, 10, 12);
  owners = new Map();
  svc = new Accounts(db, {
    chainId: CHAIN,
    now: () => now,
    readVaultOwner: async (v) => owners.get(v.toLowerCase()) ?? null,
  });
});

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof AccountError) return `${e.status} ${e.code}`;
    throw e;
  }
  return "ok";
};

async function siwe(
  pk = generatePrivateKey(),
  over: Partial<Parameters<typeof createSiweMessage>[0]> = {},
): Promise<{ message: string; signature: `0x${string}`; address: Address }> {
  const account = privateKeyToAccount(pk);
  const message = createSiweMessage({
    domain: HOST,
    address: account.address,
    statement: "Đăng nhập Guardian402",
    uri: ORIGIN,
    version: "1",
    chainId: CHAIN,
    nonce: svc.issueNonce(),
    issuedAt: new Date(now),
    expirationTime: new Date(now + 5 * 60_000),
    ...over,
  });
  return { message, signature: await account.signMessage({ message }), address: account.address };
}
const signIn = (s: { message: string; signature: string }, currentUserId?: string) =>
  svc.signInWithEthereum({ ...s, host: HOST, origin: ORIGIN, currentUserId: currentUserId ?? null });

describe("schema", () => {
  it("applies the migration once and enforces foreign keys", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    )
      .map((t) => t.name)
      .sort();
    expect(tables).toEqual([
      "agents",
      "alert_rules",
      "api_keys",
      "audit_events",
      "check_reviews",
      "contacts",
      "migrations",
      "notifications",
      "policies",
      "policy_assignments",
      "policy_changes",
      "policy_versions",
      "sessions",
      "siwe_nonces",
      "users",
      "vaults",
      "wallets",
    ]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM migrations").get() as { n: number }).n).toBe(3);
    expect(() =>
      db
        .prepare(
          "INSERT INTO wallets (user_id, chain_id, address, verified_at, created_at) VALUES ('x', 1, 'a', 0, 0)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("web2: email + password", () => {
  it("registers, never stores the password, and rejects duplicates case-insensitively", async () => {
    const u = await svc.register({
      email: " An@Example.com ",
      password: "correct horse battery",
      displayName: "An",
    });
    expect(u).toMatchObject({
      email: "an@example.com",
      hasPassword: true,
      emailVerified: false,
      displayName: "An",
    });
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(u.id) as {
      password_hash: string;
    };
    expect(row.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(row.password_hash).not.toContain("correct horse");
    expect(await code(svc.register({ email: "AN@example.com", password: "another password" }))).toBe(
      "409 email_taken",
    );
    expect(await code(svc.register({ email: "nope", password: "long enough pw" }))).toBe("400 bad_email");
    expect(await code(svc.register({ email: "b@example.com", password: "short" }))).toBe("400 weak_password");
  });

  it("signs in with the right password only, with one message for unknown emails and wrong passwords", async () => {
    await svc.register({ email: "an@example.com", password: "correct horse battery" });
    expect(
      (await svc.loginWithPassword({ email: "AN@example.com", password: "correct horse battery" }))
        .lastLoginAt,
    ).toBe(now);
    expect(await code(svc.loginWithPassword({ email: "an@example.com", password: "wrong password!" }))).toBe(
      "401 bad_credentials",
    );
    expect(await code(svc.loginWithPassword({ email: "ghost@example.com", password: "whatever123" }))).toBe(
      "401 bad_credentials",
    );
    db.prepare("UPDATE users SET status = 'disabled'").run();
    expect(
      await code(svc.loginWithPassword({ email: "an@example.com", password: "correct horse battery" })),
    ).toBe("403 disabled");
  });
});

describe("sessions", () => {
  it("stores only a hash of the token, expires after the TTL, and ends on logout", async () => {
    const u = await svc.register({ email: "an@example.com", password: "correct horse battery" });
    const token = svc.createSession(u.id, "password", null, "vitest");
    const stored = db.prepare("SELECT id FROM sessions").get() as { id: string };
    expect(stored.id).not.toBe(token);
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.sessionUser(token)).toEqual({ userId: u.id, method: "password" });
    expect(svc.sessionUser("forged")).toBeNull();
    now += SESSION_TTL_MS + 1;
    expect(svc.sessionUser(token)).toBeNull();
    now -= SESSION_TTL_MS + 1;
    svc.destroySession(token);
    expect(svc.sessionUser(token)).toBeNull();
  });
});

describe("web3: Sign-In with Ethereum", () => {
  it("creates a wallet-only account, then signs the same wallet back in", async () => {
    const pk = generatePrivateKey();
    const first = await signIn(await siwe(pk));
    expect(first.outcome).toBe("created");
    expect(first.user).toMatchObject({ email: null, hasPassword: false });
    const again = await signIn(await siwe(pk));
    expect(again).toMatchObject({ outcome: "signed_in", user: { id: first.user.id } });
    expect(svc.me(first.user.id).wallets).toEqual([
      expect.objectContaining({ address: privateKeyToAccount(pk).address, isPrimary: true, chainId: CHAIN }),
    ]);
  });

  it("links a wallet to the signed-in account, and refuses a wallet that belongs to someone else", async () => {
    const a = await svc.register({ email: "a@example.com", password: "correct horse battery" });
    const b = await svc.register({ email: "b@example.com", password: "correct horse battery" });
    const pk = generatePrivateKey();
    expect((await signIn(await siwe(pk), a.id)).outcome).toBe("linked");
    expect(await code(signIn(await siwe(pk), b.id))).toBe("409 wallet_taken");
    expect(svc.me(a.id).wallets).toHaveLength(1);
  });

  it("rejects replayed nonces, other sites, other chains, stale or expired messages and bad signatures", async () => {
    const s = await siwe();
    await signIn(s);
    expect(await code(signIn(s))).toBe("401 bad_siwe"); // nonce already used
    expect(await code(signIn(await siwe(undefined, { domain: "evil.example" })))).toBe("401 bad_siwe");
    expect(await code(signIn(await siwe(undefined, { uri: "https://evil.example" })))).toBe("401 bad_siwe");
    expect(await code(signIn(await siwe(undefined, { chainId: 1 })))).toBe("401 bad_siwe");
    expect(await code(signIn(await siwe(undefined, { issuedAt: new Date(now - 60 * 60_000) })))).toBe(
      "401 bad_siwe",
    );
    expect(await code(signIn(await siwe(undefined, { expirationTime: new Date(now - 1) })))).toBe(
      "401 bad_siwe",
    );
    expect(await code(signIn(await siwe(undefined, { nonce: "notissued123" })))).toBe("401 bad_siwe");
    const late = await siwe();
    now += NONCE_TTL_MS + 1;
    expect(await code(signIn(late))).toBe("401 bad_siwe"); // nonce expired
    now -= NONCE_TTL_MS + 1;
    const other = await siwe();
    const forged = { ...other, signature: (await siwe()).signature }; // signed by a different key
    expect(await code(signIn(forged))).toBe("401 bad_siwe");
  });

  it("never removes the last way to sign in", async () => {
    const pk = generatePrivateKey();
    const { user } = await signIn(await siwe(pk));
    const addr = privateKeyToAccount(pk).address;
    expect(await code(() => svc.unlinkWallet(user.id, addr))).toBe("409 last_login_method");
    await svc.setPassword(user.id, { email: "w@example.com", password: "correct horse battery" });
    expect(await code(() => svc.unlinkWallet(user.id, addr))).toBe("ok");
    expect(svc.me(user.id)).toMatchObject({
      user: { email: "w@example.com", hasPassword: true },
      wallets: [],
    });
  });
});

describe("vaults", () => {
  const VAULT = getAddress("0x3f6a5852788ff6a46d924c407976bb89487f7651");

  it("links a vault only when its on-chain owner is one of the user's wallets", async () => {
    const pk = generatePrivateKey();
    const { user } = await signIn(await siwe(pk));
    expect(await code(svc.linkVault(user.id, { address: "0x123" }))).toBe("400 bad_address");
    expect(await code(svc.linkVault(user.id, { address: VAULT }))).toBe("422 not_a_vault");
    owners.set(VAULT.toLowerCase(), privateKeyToAccount(generatePrivateKey()).address);
    expect(await code(svc.linkVault(user.id, { address: VAULT }))).toBe("403 not_owner");
    owners.set(VAULT.toLowerCase(), privateKeyToAccount(pk).address);
    const v = await svc.linkVault(user.id, { address: VAULT, label: "Vault demo" });
    expect(v).toMatchObject({
      address: VAULT,
      label: "Vault demo",
      ownerWallet: privateKeyToAccount(pk).address,
    });
  });

  it("follows on-chain ownership: the new owner takes the link over", async () => {
    const pkA = generatePrivateKey();
    const pkB = generatePrivateKey();
    const a = (await signIn(await siwe(pkA))).user;
    const b = (await signIn(await siwe(pkB))).user;
    owners.set(VAULT.toLowerCase(), privateKeyToAccount(pkA).address);
    await svc.linkVault(a.id, { address: VAULT });
    owners.set(VAULT.toLowerCase(), privateKeyToAccount(pkB).address); // acceptOwnership happened on chain
    await svc.linkVault(b.id, { address: VAULT });
    expect(svc.me(a.id).vaults).toEqual([]);
    expect(svc.me(b.id).vaults).toHaveLength(1);
    expect(svc.me(a.id).events.map((e) => e.event)).toContain("vault_lost");
    svc.unlinkVault(b.id, VAULT);
    expect(svc.me(b.id).vaults).toEqual([]);
  });
});

describe("rate limiter", () => {
  it("allows max attempts per window", () => {
    const l = new RateLimiter(2, 1000);
    l.take("k", 0);
    l.take("k", 10);
    expect(() => l.take("k", 20)).toThrow(AccountError);
    expect(() => l.take("k", 1500)).not.toThrow();
  });
});

describe("route handlers", () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  it("register → me → logout, with an httpOnly cookie, and refuses other origins", async () => {
    const register = (await import("../src/app/api/auth/register/route")).POST;
    const me = (await import("../src/app/api/auth/me/route")).GET;
    const logout = (await import("../src/app/api/auth/logout/route")).POST;
    const login = (await import("../src/app/api/auth/login/route")).POST;

    const evil = await register(post("/api/auth/register", {}, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);

    const res = await register(
      post("/api/auth/register", { email: "r@example.com", password: "correct horse battery" }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(
      /g402_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800/,
    );
    const cookie = cookieOf(res);

    const who = await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie } }));
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ user: { email: "r@example.com" }, wallets: [], vaults: [] });
    expect(
      JSON.stringify(await (await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie } }))).json()),
    ).not.toMatch(/password_hash|scrypt/);

    const out = await logout(post("/api/auth/logout", {}, { cookie }));
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie } }))).status).toBe(401);

    const bad = await login(post("/api/auth/login", { email: "r@example.com", password: "nope nope nope" }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "bad_credentials", message: "Sai email hoặc mật khẩu." });
    expect(
      (await login(post("/api/auth/login", { email: "r@example.com", password: "correct horse battery" })))
        .status,
    ).toBe(200);
  });
});
