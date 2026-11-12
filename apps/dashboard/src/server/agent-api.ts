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
import { knownName } from "@/lib/config";
import type { OnChainPolicy } from "@/lib/policy-spec";
import { guideline, vaultRules } from "./agent-rules";

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

  /** The vault on chain, or null when the chain cannot be read right now. */
  async #chain(vault: Address): Promise<OnChainPolicy | null> {
    try {
      return await this.#o.chain.vaultPolicy(vault);
    } catch {
      return null;
    }
  }

  /** Names the owner gave addresses (address book), then the deployment's known names. */
  #nameOf(v: VaultCtx) {
    const rows = this.#db.prepare("SELECT name, address FROM contacts WHERE vault_id = ?").all(v.id) as {
      name: string;
      address: string;
    }[];
    const book = new Map(rows.map((r) => [r.address.toLowerCase(), r.name]));
    return (a: Address) => book.get(a.toLowerCase()) ?? knownName(a) ?? null;
  }

  /**
   * The agent's identity and the rules it must follow, read from its vault on chain (the vault is the rule
   * book, SPEC §4.9): numbers for code and `guideline` sentences for an LLM agent.
   */
  async me(p: AgentPrincipal) {
    const chain = await this.#chain(p.vault.address);
    const rules = chain ? vaultRules(chain, this.#nameOf(p.vault)) : null;
    return {
      agent: p.agent,
      vault: p.vault.address,
      chainId: 43113,
      isOnChainAgent: chain ? sameAddress(chain.agent, p.agent.address) : null,
      vaultPaused: chain ? chain.paused : null,
      rules,
      guideline: rules
        ? chain && !sameAddress(chain.agent, p.agent.address)
          ? ["This wallet is not the agent of the vault: the vault rejects every payment it sends."]
          : guideline(rules)
        : ["The vault cannot be read right now. Try again in a few seconds."],
    };
  }

  /**
   * Validates a check/cosign request before it is forwarded to the Guardian (who charges for it over x402).
   * `vault` defaults to the agent's vault and may not name another one. Co-signing needs this wallet to be the
   * vault's agent on chain: a verdict for anyone else could never be used.
   */
  async prepareCheck(p: AgentPrincipal, endpoint: "check" | "cosign", body: Record<string, unknown>) {
    if (p.agent.status !== "active")
      throw new AccountError(
        403,
        "agent_not_active",
        `Agent đang ở trạng thái "${p.agent.status}": chủ két đã tạm dừng hoặc ngừng dùng agent này.`,
      );
    if (
      body.vault !== undefined &&
      !(typeof body.vault === "string" && sameAddress(body.vault, p.vault.address))
    )
      throw new AccountError(403, "wrong_vault", "API key này chỉ dùng cho két của agent.");
    const parsed = checkRequestSchema.safeParse({ chainId: 43113, ...body, vault: p.vault.address });
    if (!parsed.success)
      throw new AccountError(
        400,
        "invalid_request",
        "Yêu cầu kiểm tra không hợp lệ (cần calls[] theo docs/API.md).",
      );
    if (endpoint === "cosign") {
      const chain = await this.#chain(p.vault.address);
      if (!chain)
        throw new AccountError(503, "chain_unavailable", "Không đọc được két lúc này. Thử lại sau.");
      if (!sameAddress(chain.agent, p.agent.address))
        throw new AccountError(
          409,
          "not_vault_agent",
          "Ví này không phải agent của két: két sẽ từ chối mọi giao dịch nó gửi, nên Guardian không duyệt.",
        );
    }
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
