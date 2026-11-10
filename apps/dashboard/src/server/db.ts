// Accounts database (SQLite on node:sqlite, like the Guardian's store). Server-only: route handlers import it,
// pages never do.
//
// What lives here and what does not:
// - Off-chain identity and links: users (web2: email + password hash), wallets proven by a SIWE signature
//   (web3), sessions, the AgentVaults a user has linked, and a security audit trail.
// - Never: private keys, seed phrases, signatures, balances, policies or the vault's agent. Balances, caps,
//   allowlists and the agent are on-chain state and are always read live from the chain (rule 5 of the
//   hackathon: on-chain data is limited to hashes, payments and state; personal data stays off-chain, here).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `
  -- One person. Web2 identity (email + password) is optional: a wallet-only account has neither.
  CREATE TABLE users (
    id                TEXT PRIMARY KEY,               -- random UUID, never shown as a secret
    email             TEXT UNIQUE COLLATE NOCASE,     -- lower-cased; NULL for wallet-only accounts
    email_verified_at INTEGER,                        -- unix ms; NULL until a mailer exists (none yet)
    password_hash     TEXT,                           -- scrypt (see password.ts); NULL without email
    display_name      TEXT,
    locale            TEXT NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
    role              TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin')),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    last_login_at     INTEGER,
    CHECK (password_hash IS NULL OR email IS NOT NULL)
  );

  -- Web3 identity: an address the user proved they control by signing an EIP-4361 (SIWE) message.
  -- One address belongs to at most one account per chain.
  CREATE TABLE wallets (
    id          INTEGER PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chain_id    INTEGER NOT NULL,                     -- EIP-155 chain id (43113 = Avalanche Fuji)
    address     TEXT NOT NULL,                        -- lower-case 0x…40 hex
    label       TEXT,
    is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    verified_at INTEGER NOT NULL,                     -- time of the SIWE signature that proved control
    created_at  INTEGER NOT NULL,
    UNIQUE (chain_id, address)
  );
  CREATE INDEX wallets_user ON wallets(user_id);

  -- Single-use SIWE nonces (replay protection), valid for a few minutes.
  CREATE TABLE siwe_nonces (
    nonce      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  -- Login sessions. The cookie carries a random token; only its SHA-256 is stored.
  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,                    -- sha256(token), hex
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method       TEXT NOT NULL CHECK (method IN ('password', 'siwe')),
    wallet_id    INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent   TEXT                                 -- truncated; no IP address is stored
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- AgentVaults the user manages. Linking requires the vault's on-chain owner() to be one of the user's
  -- verified wallets; the chain stays the source of truth for balances, policy, agent and ownership.
  CREATE TABLE vaults (
    id              INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    chain_id        INTEGER NOT NULL,
    address         TEXT NOT NULL,                    -- lower-case
    label           TEXT,
    verified_at     INTEGER NOT NULL,                 -- last time owner() matched owner_wallet_id
    created_at      INTEGER NOT NULL,
    UNIQUE (chain_id, address)
  );
  CREATE INDEX vaults_user ON vaults(user_id);

  -- Security events shown to the user (sign-ins, wallets and vaults linked or removed).
  CREATE TABLE audit_events (
    id         INTEGER PRIMARY KEY,
    user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    detail     TEXT,                                  -- JSON, never secrets
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_user ON audit_events(user_id, created_at);
  `,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM migrations").all() as { id: number }[]).map((r) => r.id));
  MIGRATIONS.forEach((sql, id) => {
    if (done.has(id)) return;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  return db;
}

/** ACCOUNT_DB, else apps/dashboard/data/accounts.db (git-ignored via apps/*\/data). */
export const ACCOUNT_DB_PATH = process.env.ACCOUNT_DB || join(process.cwd(), "data", "accounts.db");

// One connection per server process; kept on globalThis so dev hot reloads do not open a new one each time.
const g = globalThis as { __g402AccountsDb?: Db };
export function getDb(): Db {
  g.__g402AccountsDb ??= openDb(ACCOUNT_DB_PATH);
  return g.__g402AccountsDb;
}
