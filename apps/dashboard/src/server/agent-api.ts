// Guardian API keys and the agent REST API (/api/agent/v1, docs/API.md "Agent API").
//
// An API key identifies one agent of one vault. With it the agent's own software (any model, any framework,
// an MCP adapter) can read its effective policy, ask the Guardian to check or co-sign a batch, read the result,
// and read the verified outcome of a transaction. A key can never change a policy, a limit or a permission:
// those are owner transactions signed in the owner's wallet. A key is not wallet authority either: revoking it
// stops calls to this API, while revoking the agent on the vault stops execution (two separate actions).
//
// Enforcement point: the vault enforces the policy on chain whether or not the agent uses this API; the checks
// here (assignment in force before co-signing) only keep the API from issuing verdicts outside the policy.
import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { checkRequestSchema } from "@guardian402/shared";
import { AccountError } from "./accounts";
import type { Db } from "./db";
import type { Policies } from "./policies";
import { sameAddress, type ChainPort, type GuardianPort } from "./ports";
import type { VaultCtx } from "./workspace";

export const KEYS_PER_AGENT = 5;
const KEY_PREFIX = "g402_";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

type KeyRow = {
  id: number;
  agent_id: number;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

/** The caller of the agent API, resolved from its key. */
export type AgentPrincipal = {
  keyId: number;
  agent: { id: number; name: string; address: Address; status: string };
  vault: VaultCtx;
};

export type AgentApiOptions = {
  chain: ChainPort;
  guardian: GuardianPort;
  policies: Policies;
  now?: () => number;
};

const unauthorized = () => new AccountError(401, "bad_api_key", "API key không hợp lệ hoặc đã bị thu hồi.");

export class AgentApi {
  readonly #db: Db;
  readonly #o: AgentApiOptions;
  readonly #now: () => number;

  constructor(db: Db, opts: AgentApiOptions) {
    this.#db = db;
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
  }

  #audit(userId: string, event: string, detail: Record<string, unknown>) {
    this.#db
      .prepare("INSERT INTO audit_events (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, event, JSON.stringify(detail), this.#now());
  }

  #agentRow(v: VaultCtx, agentId: unknown) {
    const n = Number(agentId);
    const row = Number.isSafeInteger(n)
      ? (this.#db
          .prepare("SELECT id, name, address, status FROM agents WHERE id = ? AND vault_id = ?")
          .get(n, v.id) as { id: number; name: string; address: string; status: string } | undefined)
      : undefined;
    if (!row) throw new AccountError(404, "not_found", "Không tìm thấy agent.");
    return row;
  }

  #key(r: KeyRow) {
    return {
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
    };
  }

  // ================================================================== owner side: keys

  listKeys(v: VaultCtx, agentId: unknown) {
    const agent = this.#agentRow(v, agentId);
    return (
      this.#db
        .prepare("SELECT * FROM api_keys WHERE agent_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC")
        .all(agent.id) as KeyRow[]
    ).map((r) => this.#key(r));
  }

  /** A new key. The plain key is returned only here; the database keeps its sha256. */
  createKey(v: VaultCtx, agentId: unknown, input: Record<string, unknown>) {
    const agent = this.#agentRow(v, agentId);
    if (agent.status === "retired")
      throw new AccountError(409, "agent_retired", "Agent đã ngừng dùng: không cấp key mới.");
    const raw = typeof input.name === "string" ? input.name.trim() : "";
    // eslint-disable-next-line no-control-regex
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60) || "API key";
    const active = (
      this.#db
        .prepare("SELECT COUNT(*) AS n FROM api_keys WHERE agent_id = ? AND revoked_at IS NULL")
        .get(agent.id) as { n: number }
    ).n;
    if (active >= KEYS_PER_AGENT)
      throw new AccountError(409, "limit", `Tối đa ${KEYS_PER_AGENT} key đang dùng cho một agent.`);
    const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const prefix = key.slice(0, KEY_PREFIX.length + 6);
    const res = this.#db
      .prepare("INSERT INTO api_keys (agent_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(agent.id, name, prefix, sha256(key), this.#now());
    this.#audit(v.userId, "api_key_created", { vault: v.address, agent: getAddress(agent.address), prefix });
    const row = this.#db
      .prepare("SELECT * FROM api_keys WHERE id = ?")
      .get(Number(res.lastInsertRowid)) as KeyRow;
    return { key, apiKey: this.#key(row) };
  }

  revokeKey(v: VaultCtx, agentId: unknown, keyId: unknown) {
    const agent = this.#agentRow(v, agentId);
    const row = this.#db
      .prepare("SELECT * FROM api_keys WHERE id = ? AND agent_id = ?")
      .get(Number(keyId) || 0, agent.id) as KeyRow | undefined;
    if (!row) throw new AccountError(404, "not_found", "Không tìm thấy API key.");
    if (row.revoked_at === null) {
      this.#db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(this.#now(), row.id);
      this.#audit(v.userId, "api_key_revoked", { vault: v.address, prefix: row.prefix });
    }
    return this.#key(this.#db.prepare("SELECT * FROM api_keys WHERE id = ?").get(row.id) as KeyRow);
  }

  // ================================================================== agent side

  /** Resolves `Authorization: Bearer g402_…`. Unknown, malformed and revoked keys look the same (401). */
  authenticate(authorization: string | null): AgentPrincipal {
    const m = /^Bearer\s+(g402_[A-Za-z0-9_-]{20,64})$/.exec(authorization?.trim() ?? "");
    if (!m?.[1]) throw unauthorized();
    const row = this.#db
      .prepare(
        `SELECT k.id AS key_id, k.revoked_at, ag.id AS agent_id, ag.name, ag.address, ag.status,
                vt.id AS vault_id, vt.user_id, vt.address AS vault
         FROM api_keys k JOIN agents ag ON ag.id = k.agent_id JOIN vaults vt ON vt.id = ag.vault_id
         WHERE k.key_hash = ?`,
      )
      .get(sha256(m[1])) as
      | {
          key_id: number;
          revoked_at: number | null;
          agent_id: number;
          name: string;
          address: string;
          status: string;
          vault_id: number;
          user_id: string;
          vault: string;
        }
      | undefined;
    if (!row || row.revoked_at !== null) throw unauthorized();
    this.#db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(this.#now(), row.key_id);
    return {
      keyId: row.key_id,
      agent: { id: row.agent_id, name: row.name, address: getAddress(row.address), status: row.status },
      vault: { id: row.vault_id, userId: row.user_id, address: getAddress(row.vault) },
    };
  }

  /** The agent's identity, its effective policy and whether the vault enforces it, and today's budget. */
  async me(p: AgentPrincipal) {
    const { assignment, enforcement, chain } = await this.#o.policies.forAgent(p.vault, p.agent.id);
    const spent = (token: Address) => chain?.tokens.find((t) => sameAddress(t.token, token));
    return {
      agent: p.agent,
      vault: p.vault.address,
      chainId: 43113,
      isOnChainAgent: chain ? sameAddress(chain.agent, p.agent.address) : null,
      vaultPaused: chain ? chain.paused : null,
      policy: assignment
        ? {
            id: assignment.policy.id,
            name: assignment.policy.name,
            version: assignment.version.version,
            latestVersion: assignment.policy.latestVersion,
            spec: assignment.version.spec,
            summary: assignment.version.summary,
          }
        : null,
      enforcement: enforcement
        ? enforcement.state === "pending"
          ? { state: "pending", ownerChangesNeeded: enforcement.plan.changes.length }
          : { state: enforcement.state }
        : { state: "no_policy" },
      budget: assignment
        ? [
            ...assignment.version.spec.tokens.map((t) => ({
              token: t.token,
              dailyCap: t.dailyCap,
              verdictThreshold: t.verdictThreshold,
              spentToday: spent(t.token)?.spentToday.toString() ?? null,
            })),
            {
              token: "native",
              dailyCap: assignment.version.spec.native.dailyCap,
              verdictThreshold: assignment.version.spec.native.verdictThreshold,
              spentToday: chain ? chain.nativeSpentToday.toString() : null,
            },
          ]
        : [],
      note: "Ngân sách tính theo số dư vault giảm trong ngày UTC, chung cho cả vault.",
    };
  }

  /**
   * Validates a check/cosign request before it is forwarded to the Guardian (who charges for it over x402).
   * `vault` defaults to the agent's vault and may not name another one. Co-signing needs the policy in force:
   * a verdict is what lets the agent move more than its verdict thresholds.
   */
  async prepareCheck(p: AgentPrincipal, endpoint: "check" | "cosign", body: Record<string, unknown>) {
    if (p.agent.status !== "active")
      throw new AccountError(
        403,
        "agent_not_active",
        `Agent đang ở trạng thái "${p.agent.status}": chủ vault đã tạm dừng hoặc ngừng dùng agent này.`,
      );
    if (
      body.vault !== undefined &&
      !(typeof body.vault === "string" && sameAddress(body.vault, p.vault.address))
    )
      throw new AccountError(403, "wrong_vault", "API key này chỉ dùng cho vault của agent.");
    const parsed = checkRequestSchema.safeParse({ chainId: 43113, ...body, vault: p.vault.address });
    if (!parsed.success)
      throw new AccountError(
        400,
        "invalid_request",
        "Yêu cầu kiểm tra không hợp lệ (cần calls[] theo docs/API.md).",
      );
    const { assignment, enforcement } = await this.#o.policies.forAgent(p.vault, p.agent.id);
    if (!assignment)
      throw new AccountError(409, "no_policy", "Agent chưa được gán policy: chủ vault cần gán policy trước.");
    if (endpoint === "cosign" && enforcement?.state !== "active")
      throw new AccountError(
        409,
        enforcement?.state === "unknown" ? "chain_unavailable" : "policy_not_active",
        enforcement?.state === "unknown"
          ? "Không đọc được vault để xác nhận policy đang hiệu lực. Thử lại sau."
          : "Policy chưa có hiệu lực trên vault (chủ vault chưa ký đủ thay đổi): không cấp verdict.",
      );
    return parsed.data;
  }

  /** A Guardian check of this agent's vault (other vaults' checks are a 404). */
  async check(p: AgentPrincipal, checkId: string) {
    const c = await this.#o.guardian.check(checkId);
    if (!c || !sameAddress(c.vault, p.vault.address))
      throw new AccountError(404, "not_found", "Không tìm thấy lần kiểm tra này cho vault của agent.");
    return c;
  }

  /** The verified outcome of a transaction: mined or not, success or revert, and the vault's Executed event. */
  async execution(p: AgentPrincipal, hash: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new AccountError(400, "bad_tx", "Mã giao dịch không hợp lệ.");
    const x = await this.#o.chain.execution(p.vault.address, hash as Hex);
    if (!x.found) return { found: false as const, state: "not_found" as const };
    const toVault = x.to !== null && isAddress(x.to) && sameAddress(x.to, p.vault.address);
    return {
      found: true as const,
      state:
        x.status === "pending"
          ? ("pending" as const)
          : x.status === "reverted"
            ? ("reverted" as const)
            : x.executed
              ? ("executed" as const)
              : ("confirmed_without_execution" as const),
      toVault,
      fromAgent: sameAddress(x.from, p.agent.address),
      blockNumber: x.blockNumber,
      executed: x.executed,
    };
  }
}

/** Request headers of x402 (v2 and v1 names) passed through to the Guardian, and response headers passed back. */
export const PAYMENT_REQUEST_HEADERS = ["payment-signature", "x-payment"] as const;
export const PAYMENT_RESPONSE_HEADERS = [
  "payment-required",
  "payment-response",
  "x-payment-response",
] as const;
