// Account rules (web2 + web3), independent of Next.js so they can be tested on an in-memory database.
//
// - Web2: register / sign in with email + password (scrypt). Emails are unique, case-insensitive.
// - Web3: Sign-In with Ethereum (EIP-4361). A signed message proves control of an address; the address is then
//   a wallet of the account. Signed in → the wallet is linked to the current account. Not signed in → the
//   wallet's account signs in, or a wallet-only account is created. An address belongs to one account.
// - A user can never remove their last way to sign in.
// - Linking an AgentVault requires its on-chain owner() to be one of the user's verified wallets; ownership
//   moves on-chain (Ownable2Step), so a vault link follows the current on-chain owner.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import type { Db } from "./db";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "./password";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NONCE_TTL_MS = 5 * 60 * 1000;
/** A SIWE message must have been issued recently, whatever its own expirationTime says. */
export const SIWE_MAX_AGE_MS = 10 * 60 * 1000;

export class AccountError extends Error {
  override readonly name = "AccountError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Next.js bundles each route handler separately, so an error thrown by the shared Accounts instance (kept on
 * globalThis) may come from another bundle's AccountError class: recognise it by shape, not by instanceof.
 */
export function isAccountError(e: unknown): e is AccountError {
  return (
    e instanceof Error &&
    e.name === "AccountError" &&
    typeof (e as AccountError).status === "number" &&
    typeof (e as AccountError).code === "string"
  );
}

export type SessionMethod = "password" | "siwe";

type UserRow = {
  id: string;
  email: string | null;
  email_verified_at: number | null;
  password_hash: string | null;
  display_name: string | null;
  locale: "vi" | "en";
  role: "owner" | "admin";
  status: "active" | "disabled";
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
};
type WalletRow = {
  id: number;
  user_id: string;
  chain_id: number;
  address: string;
  label: string | null;
  is_primary: number;
  verified_at: number;
  created_at: number;
};
type VaultRow = {
  id: number;
  user_id: string;
  owner_wallet_id: number;
  chain_id: number;
  address: string;
  label: string | null;
  verified_at: number;
  created_at: number;
};

/** What the API returns about a user: never the password hash. */
export type PublicUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  displayName: string | null;
  locale: "vi" | "en";
  role: "owner" | "admin";
  createdAt: number;
  lastLoginAt: number | null;
};
export type PublicWallet = {
  chainId: number;
  address: Address;
  label: string | null;
  isPrimary: boolean;
  verifiedAt: number;
};
export type PublicVault = {
  chainId: number;
  address: Address;
  label: string | null;
  ownerWallet: Address;
  verifiedAt: number;
};
export type AuditEvent = { event: string; detail: Record<string, unknown> | null; createdAt: number };
export type Me = { user: PublicUser; wallets: PublicWallet[]; vaults: PublicVault[]; events: AuditEvent[] };

export type AccountsOptions = {
  /** The chain wallets and vaults are bound to (43113 on Fuji and on the fork). */
  chainId: number;
  /** Reads AgentVault.owner() on chain; null when the address is not an AgentVault. */
  readVaultOwner: (vault: Address) => Promise<Address | null>;
  now?: () => number;
};

/** Workspace tables keyed by vault_id (migration 1). */
export const VAULT_WORKSPACE_TABLES = [
  "agents",
  "contacts",
  "policy_changes",
  "notifications",
  "alert_rules",
  "check_reviews",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Trim, drop control characters, cap the length; null when empty. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

export class Accounts {
  readonly #db: Db;
  readonly #chainId: number;
  readonly #readVaultOwner: AccountsOptions["readVaultOwner"];
  readonly #now: () => number;

  constructor(db: Db, opts: AccountsOptions) {
    this.#db = db;
    this.#chainId = opts.chainId;
    this.#readVaultOwner = opts.readVaultOwner;
    this.#now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------------ web2: email + password

  async register(input: { email?: unknown; password?: unknown; displayName?: unknown }): Promise<PublicUser> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254)
      throw new AccountError(400, "bad_email", "Email không hợp lệ.");
    const password = typeof input.password === "string" ? input.password : "";
    const problem = passwordProblem(password);
    if (problem) throw new AccountError(400, "weak_password", problem);
    if (this.#db.prepare("SELECT 1 FROM users WHERE email = ?").get(email))
      throw new AccountError(409, "email_taken", "Email này đã có tài khoản. Hãy đăng nhập.");
    const now = this.#now();
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, email, await hashPassword(password), cleanText(input.displayName, 60), now, now, now);
    this.audit(id, "register", { method: "password" });
    return this.#publicUser(this.#user(id));
  }

  async loginWithPassword(input: { email?: unknown; password?: unknown }): Promise<PublicUser> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const row = this.#db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    // Same message and similar timing whether the email exists or not.
    const bad = new AccountError(401, "bad_credentials", "Sai email hoặc mật khẩu.");
    if (!row?.password_hash) {
      await burnPasswordCheck(password);
      throw bad;
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      this.audit(row.id, "login_failed", { method: "password" });
      throw bad;
    }
    this.#assertActive(row);
    this.#touchLogin(row.id);
    this.audit(row.id, "login", { method: "password" });
    return this.#publicUser(this.#user(row.id));
  }

  /** Adds email + password to an account (e.g. a wallet-only one). */
  async setPassword(
    userId: string,
    input: { email?: unknown; password?: unknown; currentPassword?: unknown },
  ) {
    const row = this.#user(userId);
    const password = typeof input.password === "string" ? input.password : "";
    const problem = passwordProblem(password);
    if (problem) throw new AccountError(400, "weak_password", problem);
    if (row.password_hash) {
      const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
      if (!(await verifyPassword(current, row.password_hash)))
        throw new AccountError(403, "bad_credentials", "Mật khẩu hiện tại không đúng.");
    }
    let email = row.email;
    if (!email) {
      email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email) || email.length > 254)
        throw new AccountError(400, "bad_email", "Email không hợp lệ.");
      if (this.#db.prepare("SELECT 1 FROM users WHERE email = ?").get(email))
        throw new AccountError(409, "email_taken", "Email này đã thuộc tài khoản khác.");
    }
    this.#db
      .prepare("UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?")
      .run(email, await hashPassword(password), this.#now(), userId);
    // The route then ends the user's other sessions (destroyOtherSessions).
    this.audit(userId, row.password_hash ? "password_changed" : "password_added", null);
  }

  // ------------------------------------------------------------------ web3: Sign-In with Ethereum

  issueNonce(): string {
    const now = this.#now();
    this.#db.prepare("DELETE FROM siwe_nonces WHERE expires_at < ?").run(now - NONCE_TTL_MS);
    const nonce = randomBytes(16).toString("hex"); // EIP-4361: at least 8 alphanumeric characters
    this.#db
      .prepare("INSERT INTO siwe_nonces (nonce, created_at, expires_at) VALUES (?, ?, ?)")
      .run(nonce, now, now + NONCE_TTL_MS);
    return nonce;
  }

  /**
   * Verifies a signed SIWE message for this site (`host`, `origin`) and returns the account it signs in.
   * `currentUserId` set (already signed in): the wallet is linked to that account.
   */
  async signInWithEthereum(input: {
    message: unknown;
    signature: unknown;
    host: string;
    origin: string;
    currentUserId?: string | null | undefined;
  }): Promise<{ user: PublicUser; walletId: number; outcome: "signed_in" | "linked" | "created" }> {
    const invalid = (why: string) =>
      new AccountError(401, "bad_siwe", `Chữ ký đăng nhập không hợp lệ (${why}).`);
    if (typeof input.message !== "string" || input.message.length > 4000) throw invalid("thông điệp");
    if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature))
      throw invalid("chữ ký");
    const msg = parseSiweMessage(input.message);
    const now = this.#now();
    if (!msg.address || !isAddress(msg.address)) throw invalid("địa chỉ");
    if (msg.version !== "1") throw invalid("phiên bản");
    if (msg.chainId !== this.#chainId) throw invalid("chain id");
    if (msg.domain !== input.host) throw invalid("tên miền");
    let uriOrigin = "";
    try {
      uriOrigin = new URL(msg.uri ?? "").origin;
    } catch {
      /* invalid below */
    }
    if (uriOrigin !== input.origin) throw invalid("uri");
    if (!msg.issuedAt || Math.abs(now - msg.issuedAt.getTime()) > SIWE_MAX_AGE_MS)
      throw invalid("thời điểm ký");
    if (!msg.nonce || !validateSiweMessage({ message: msg, domain: input.host, time: new Date(now) }))
      throw invalid("hết hạn");
    // Consume the nonce before checking the signature: one attempt per nonce.
    const consumed = this.#db
      .prepare("UPDATE siwe_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?")
      .run(now, msg.nonce, now);
    if (consumed.changes !== 1) throw invalid("nonce");
    const ok = await verifyMessage({
      address: msg.address,
      message: input.message,
      signature: input.signature as Hex,
    }).catch(() => false);
    if (!ok) throw invalid("chữ ký");

    const address = msg.address.toLowerCase();
    const wallet = this.#db
      .prepare("SELECT * FROM wallets WHERE chain_id = ? AND address = ?")
      .get(this.#chainId, address) as WalletRow | undefined;
    const current = input.currentUserId ?? null;

    if (wallet) {
      if (current && wallet.user_id !== current)
        throw new AccountError(409, "wallet_taken", "Ví này đã liên kết với một tài khoản khác.");
      this.#db.prepare("UPDATE wallets SET verified_at = ? WHERE id = ?").run(now, wallet.id);
      const owner = this.#user(wallet.user_id);
      this.#assertActive(owner);
      if (!current) {
        this.#touchLogin(owner.id);
        this.audit(owner.id, "login", { method: "siwe", address });
      }
      return { user: this.#publicUser(this.#user(owner.id)), walletId: wallet.id, outcome: "signed_in" };
    }

    let userId = current;
    let outcome: "linked" | "created" = "linked";
    if (!userId) {
      userId = randomUUID();
      outcome = "created";
      this.#db
        .prepare("INSERT INTO users (id, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?)")
        .run(userId, now, now, now);
      this.audit(userId, "register", { method: "siwe", address });
    } else {
      this.#assertActive(this.#user(userId));
    }
    const hasWallet = this.#db.prepare("SELECT 1 FROM wallets WHERE user_id = ?").get(userId);
    const res = this.#db
      .prepare(
        `INSERT INTO wallets (user_id, chain_id, address, is_primary, verified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, this.#chainId, address, hasWallet ? 0 : 1, now, now);
    this.audit(userId, "wallet_linked", { address });
    return { user: this.#publicUser(this.#user(userId)), walletId: Number(res.lastInsertRowid), outcome };
  }

  unlinkWallet(userId: string, rawAddress: string) {
    if (!isAddress(rawAddress)) throw new AccountError(400, "bad_address", "Địa chỉ ví không hợp lệ.");
    const address = rawAddress.toLowerCase();
    const wallet = this.#db
      .prepare("SELECT * FROM wallets WHERE user_id = ? AND chain_id = ? AND address = ?")
      .get(userId, this.#chainId, address) as WalletRow | undefined;
    if (!wallet) throw new AccountError(404, "not_found", "Ví này không thuộc tài khoản của bạn.");
    const user = this.#user(userId);
    const others = (
      this.#db.prepare("SELECT COUNT(*) AS n FROM wallets WHERE user_id = ?").get(userId) as { n: number }
    ).n;
    if (!user.password_hash && others <= 1)
      throw new AccountError(
        409,
        "last_login_method",
        "Đây là cách đăng nhập duy nhất của tài khoản. Hãy thêm email và mật khẩu trước khi gỡ ví.",
      );
    this.#db.exec("BEGIN");
    try {
      // Vault links owned through this wallet go with it (ON DELETE CASCADE).
      this.#db.prepare("DELETE FROM wallets WHERE id = ?").run(wallet.id);
      if (wallet.is_primary)
        this.#db
          .prepare(
            "UPDATE wallets SET is_primary = 1 WHERE id = (SELECT id FROM wallets WHERE user_id = ? ORDER BY created_at LIMIT 1)",
          )
          .run(userId);
      this.#db.exec("COMMIT");
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
    this.audit(userId, "wallet_unlinked", { address });
  }

  // ------------------------------------------------------------------ vaults

  async linkVault(userId: string, input: { address?: unknown; label?: unknown }): Promise<PublicVault> {
    if (typeof input.address !== "string" || !isAddress(input.address))
      throw new AccountError(400, "bad_address", "Địa chỉ két không hợp lệ.");
    const vault = getAddress(input.address);
    const owner = await this.#readVaultOwner(vault);
    if (!owner)
      throw new AccountError(
        422,
        "not_a_vault",
        "Không đọc được AgentVault ở địa chỉ này trên mạng hiện tại.",
      );
    const wallet = this.#db
      .prepare("SELECT * FROM wallets WHERE user_id = ? AND chain_id = ? AND address = ?")
      .get(userId, this.#chainId, owner.toLowerCase()) as WalletRow | undefined;
    if (!wallet)
      throw new AccountError(
        403,
        "not_owner",
        `Chủ của két này trên chain là ${owner}. Hãy đăng nhập/liên kết đúng ví đó trước.`,
      );
    const now = this.#now();
    const label = cleanText(input.label, 40);
    const existing = this.#db
      .prepare("SELECT * FROM vaults WHERE chain_id = ? AND address = ?")
      .get(this.#chainId, vault.toLowerCase()) as VaultRow | undefined;
    if (existing) {
      // The chain says this user owns it now (e.g. after an Ownable2Step hand-off): the link follows, and the
      // previous owner's workspace (agents, contacts, notes, alerts…) is purged, never handed over.
      if (existing.user_id !== userId) {
        this.audit(existing.user_id, "vault_lost", { address: vault, newOwner: owner });
        for (const table of VAULT_WORKSPACE_TABLES)
          this.#db.prepare(`DELETE FROM ${table} WHERE vault_id = ?`).run(existing.id);
      }
      this.#db
        .prepare(
          "UPDATE vaults SET user_id = ?, owner_wallet_id = ?, label = COALESCE(?, label), verified_at = ? WHERE id = ?",
        )
        .run(userId, wallet.id, label, now, existing.id);
    } else {
      this.#db
        .prepare(
          `INSERT INTO vaults (user_id, owner_wallet_id, chain_id, address, label, verified_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, wallet.id, this.#chainId, vault.toLowerCase(), label, now, now);
    }
    this.audit(userId, "vault_linked", { address: vault });
    const v = this.me(userId).vaults.find((x) => x.address === vault);
    if (!v) throw new AccountError(500, "internal", "Không lưu được két.");
    return v;
  }

  unlinkVault(userId: string, rawAddress: string) {
    if (!isAddress(rawAddress)) throw new AccountError(400, "bad_address", "Địa chỉ két không hợp lệ.");
    const res = this.#db
      .prepare("DELETE FROM vaults WHERE user_id = ? AND chain_id = ? AND address = ?")
      .run(userId, this.#chainId, rawAddress.toLowerCase());
    if (res.changes !== 1)
      throw new AccountError(404, "not_found", "Vault này không thuộc tài khoản của bạn.");
    this.audit(userId, "vault_unlinked", { address: getAddress(rawAddress) });
  }

  // ------------------------------------------------------------------ profile

  updateProfile(userId: string, input: { displayName?: unknown; locale?: unknown }): PublicUser {
    const row = this.#user(userId);
    const locale = input.locale === "en" || input.locale === "vi" ? input.locale : row.locale;
    const displayName = input.displayName === undefined ? row.display_name : cleanText(input.displayName, 60);
    this.#db
      .prepare("UPDATE users SET display_name = ?, locale = ?, updated_at = ? WHERE id = ?")
      .run(displayName, locale, this.#now(), userId);
    return this.#publicUser(this.#user(userId));
  }

  me(userId: string): Me {
    const user = this.#publicUser(this.#user(userId));
    const wallets = (
      this.#db
        .prepare("SELECT * FROM wallets WHERE user_id = ? ORDER BY is_primary DESC, created_at")
        .all(userId) as WalletRow[]
    ).map((w) => ({
      chainId: w.chain_id,
      address: getAddress(w.address),
      label: w.label,
      isPrimary: w.is_primary === 1,
      verifiedAt: w.verified_at,
    }));
    const vaults = (
      this.#db
        .prepare(
          `SELECT v.*, w.address AS owner_address FROM vaults v JOIN wallets w ON w.id = v.owner_wallet_id
           WHERE v.user_id = ? ORDER BY v.created_at`,
        )
        .all(userId) as (VaultRow & { owner_address: string })[]
    ).map((v) => ({
      chainId: v.chain_id,
      address: getAddress(v.address),
      label: v.label,
      ownerWallet: getAddress(v.owner_address),
      verifiedAt: v.verified_at,
    }));
    const events = (
      this.#db
        .prepare(
          "SELECT event, detail, created_at FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        )
        .all(userId) as { event: string; detail: string | null; created_at: number }[]
    ).map((e) => ({
      event: e.event,
      detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null,
      createdAt: e.created_at,
    }));
    return { user, wallets, vaults, events };
  }

  // ------------------------------------------------------------------ sessions

  /** Returns the cookie token; the database keeps only its hash. */
  createSession(
    userId: string,
    method: SessionMethod,
    walletId: number | null,
    userAgent: string | null,
  ): string {
    const now = this.#now();
    this.#db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    const token = randomBytes(32).toString("base64url");
    this.#db
      .prepare(
        `INSERT INTO sessions (id, user_id, method, wallet_id, created_at, expires_at, last_seen_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256(token),
        userId,
        method,
        walletId,
        now,
        now + SESSION_TTL_MS,
        now,
        userAgent?.slice(0, 200) ?? null,
      );
    return token;
  }

  /** The signed-in user for a cookie token, or null (unknown, expired, or disabled account). */
  sessionUser(token: string | undefined | null): { userId: string; method: SessionMethod } | null {
    if (!token) return null;
    const now = this.#now();
    const row = this.#db
      .prepare(
        `SELECT s.id, s.user_id, s.method, s.last_seen_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), now) as
      | { id: string; user_id: string; method: SessionMethod; last_seen_at: number; status: string }
      | undefined;
    if (!row || row.status !== "active") return null;
    if (now - row.last_seen_at > 60_000)
      this.#db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, row.id);
    return { userId: row.user_id, method: row.method };
  }

  destroySession(token: string | undefined | null) {
    if (token) this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
  }

  /** Ends every session of a user except, optionally, the one with `keepToken`. */
  destroyOtherSessions(userId: string, keepToken?: string) {
    this.#db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .run(userId, keepToken ? sha256(keepToken) : "");
  }

  // ------------------------------------------------------------------ helpers

  audit(userId: string | null, event: string, detail: Record<string, unknown> | null) {
    this.#db
      .prepare("INSERT INTO audit_events (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, event, detail ? JSON.stringify(detail) : null, this.#now());
  }

  #user(id: string): UserRow {
    const row = this.#db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) throw new AccountError(404, "not_found", "Không tìm thấy tài khoản.");
    return row;
  }

  #assertActive(row: UserRow) {
    if (row.status !== "active") throw new AccountError(403, "disabled", "Tài khoản đã bị khoá.");
  }

  #touchLogin(id: string) {
    const now = this.#now();
    this.#db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  #publicUser(r: UserRow): PublicUser {
    return {
      id: r.id,
      email: r.email,
      emailVerified: r.email_verified_at !== null,
      hasPassword: r.password_hash !== null,
      displayName: r.display_name,
      locale: r.locale,
      role: r.role,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    };
  }
}
