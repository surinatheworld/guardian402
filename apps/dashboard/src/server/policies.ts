// Policies: named, versioned sets of permissions and limits (src/lib/policy-spec.ts) that the owner assigns to
// an agent. A policy is the owner's intent; it is in force only once the vault's on-chain state matches it, which
// is always read from the chain. Applying an assignment drafts the owner transactions (workspace policy
// changes) that make the vault match; nothing changes on chain until the owner's wallet signs each of them.
import { getAddress, type Address } from "viem";
import { naming as catalogNaming, TEMPLATES, type TemplateId } from "@/lib/policy-catalog";
import {
  canonicalSpec,
  parseSpec,
  planChanges,
  SpecError,
  summarize,
  specWarnings,
  type Naming,
  type OnChainPolicy,
  type Plan,
  type PolicySpec,
} from "@/lib/policy-spec";
import { AccountError } from "./accounts";
import type { Db } from "./db";
import type { ChainPort } from "./ports";
import type { VaultCtx, Workspace } from "./workspace";

export const POLICY_LIBRARY_LIMIT = 30;

export type PoliciesOptions = { chain: ChainPort; workspace: Workspace; now?: () => number };

type PolicyRow = {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  template: TemplateId;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};
type VersionRow = {
  id: number;
  policy_id: number;
  version: number;
  spec: string;
  note: string | null;
  created_at: number;
};
type AssignmentRow = {
  id: number;
  agent_id: number;
  policy_version_id: number;
  state: "current" | "ended";
  created_at: number;
  ended_at: number | null;
};
type AgentRow = { id: number; vault_id: number; name: string; address: string; status: string };

/** Whether an assignment is in force on chain. `unknown` when the chain could not be read. */
export type Enforcement =
  | { state: "active"; plan: Plan }
  | { state: "pending"; plan: Plan; drafts: number; submitted: number }
  | { state: "unknown" };

const bad = (code: string, message: string) => new AccountError(400, code, message);
const notFound = (what: string) => new AccountError(404, "not_found", `Không tìm thấy ${what}.`);

function text(value: unknown, max: number, field: string, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad("missing_field", `Thiếu ${field}.`);
    return null;
  }
  if (typeof value !== "string") throw bad("bad_field", `${field} phải là chuỗi.`);
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!t && required) throw bad("missing_field", `Thiếu ${field}.`);
  if (t.length > max) throw bad("too_long", `${field} tối đa ${max} ký tự.`);
  return t || null;
}

const positiveId = (value: unknown, what: string): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound(what);
  return n;
};

function spec(raw: unknown, vault?: Address): PolicySpec {
  try {
    return parseSpec(raw, vault);
  } catch (e) {
    if (e instanceof SpecError) throw bad("bad_spec", e.message);
    throw e;
  }
}

export class Policies {
  readonly #db: Db;
  readonly #o: PoliciesOptions;
  readonly #now: () => number;

  constructor(db: Db, opts: PoliciesOptions) {
    this.#db = db;
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
  }

  #audit(userId: string, event: string, detail: Record<string, unknown>) {
    this.#db
      .prepare("INSERT INTO audit_events (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, event, JSON.stringify(detail), this.#now());
  }

  /** Names for summaries: the vault's address book (when there is a vault) and the deployment's contracts. */
  #naming(vaultId?: number): Naming {
    const contacts = vaultId
      ? (this.#db.prepare("SELECT name, address FROM contacts WHERE vault_id = ?").all(vaultId) as {
          name: string;
          address: string;
        }[])
      : [];
    return catalogNaming(contacts);
  }

  // ================================================================== library (per user)

  #row(userId: string, policyId: unknown): PolicyRow {
    const row = this.#db
      .prepare("SELECT * FROM policies WHERE id = ? AND user_id = ?")
      .get(positiveId(policyId, "policy"), userId) as PolicyRow | undefined;
    if (!row) throw notFound("policy");
    return row;
  }

  #latest(policyId: number): VersionRow {
    return this.#db
      .prepare("SELECT * FROM policy_versions WHERE policy_id = ? ORDER BY version DESC LIMIT 1")
      .get(policyId) as VersionRow;
  }

  #version(v: VersionRow, n: Naming) {
    const s = JSON.parse(v.spec) as PolicySpec;
    return {
      id: v.id,
      version: v.version,
      spec: s,
      summary: summarize(s, n),
      warnings: specWarnings(s, n),
      note: v.note,
      createdAt: v.created_at,
    };
  }

  #view(r: PolicyRow, n: Naming) {
    const assignments = this.#db
      .prepare(
        `SELECT a.id, a.agent_id, ag.name AS agent_name, ag.vault_id, vt.address AS vault, pv.version
         FROM policy_assignments a
         JOIN policy_versions pv ON pv.id = a.policy_version_id
         JOIN agents ag ON ag.id = a.agent_id
         JOIN vaults vt ON vt.id = ag.vault_id
         WHERE pv.policy_id = ? AND a.state = 'current'
         ORDER BY ag.name COLLATE NOCASE`,
      )
      .all(r.id) as { id: number; agent_id: number; agent_name: string; vault: string; version: number }[];
    const versions = (
      this.#db.prepare("SELECT COUNT(*) AS n FROM policy_versions WHERE policy_id = ?").get(r.id) as {
        n: number;
      }
    ).n;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      template: r.template,
      archived: r.archived_at !== null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      latest: this.#version(this.#latest(r.id), n),
      versionCount: versions,
      assignments: assignments.map((a) => ({
        assignmentId: a.id,
        agentId: a.agent_id,
        agentName: a.agent_name,
        vault: getAddress(a.vault),
        version: a.version,
      })),
    };
  }

  /** The user's policies (archived ones last); names resolved with `vaultId`'s address book when given. */
  list(userId: string, vaultId?: number) {
    const n = this.#naming(vaultId);
    return (
      this.#db
        .prepare("SELECT * FROM policies WHERE user_id = ? ORDER BY archived_at IS NOT NULL, updated_at DESC")
        .all(userId) as PolicyRow[]
    ).map((r) => this.#view(r, n));
  }

  get(userId: string, policyId: unknown, vaultId?: number) {
    const r = this.#row(userId, policyId);
    const n = this.#naming(vaultId);
    const versions = (
      this.#db
        .prepare("SELECT * FROM policy_versions WHERE policy_id = ? ORDER BY version DESC")
        .all(r.id) as VersionRow[]
    ).map((v) => this.#version(v, n));
    return { ...this.#view(r, n), versions };
  }

  #nameTaken(userId: string, name: string, exceptId?: number) {
    return Boolean(
      this.#db
        .prepare(
          "SELECT 1 FROM policies WHERE user_id = ? AND name = ? COLLATE NOCASE AND archived_at IS NULL AND id != ?",
        )
        .get(userId, name, exceptId ?? 0),
    );
  }

  create(userId: string, input: Record<string, unknown>, vaultId?: number) {
    const name = text(input.name, 60, "Tên policy", true) as string;
    const template = (
      TEMPLATES.some((t) => t.id === input.template) ? input.template : "custom"
    ) as TemplateId;
    const s = spec(input.spec);
    if (this.#nameTaken(userId, name)) throw new AccountError(409, "duplicate", "Đã có policy cùng tên.");
    const active = (
      this.#db
        .prepare("SELECT COUNT(*) AS n FROM policies WHERE user_id = ? AND archived_at IS NULL")
        .get(userId) as { n: number }
    ).n;
    if (active >= POLICY_LIBRARY_LIMIT)
      throw new AccountError(409, "limit", `Tối đa ${POLICY_LIBRARY_LIMIT} policy đang dùng.`);
    const now = this.#now();
    this.#db.exec("BEGIN");
    try {
      const res = this.#db
        .prepare(
          `INSERT INTO policies (user_id, name, description, template, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, name, text(input.description, 300, "Mô tả"), template, now, now);
      const id = Number(res.lastInsertRowid);
      this.#db
        .prepare(
          "INSERT INTO policy_versions (policy_id, version, spec, note, created_at) VALUES (?, 1, ?, ?, ?)",
        )
        .run(id, JSON.stringify(s), text(input.note, 300, "Ghi chú"), now);
      this.#db.exec("COMMIT");
      this.#audit(userId, "policy_created", { policyId: id, name });
      return this.get(userId, id, vaultId);
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Name and description change in place. New rules make a new version (only when they differ from the latest);
   * agents keep the version they were assigned until the owner moves them to the new one.
   */
  update(userId: string, policyId: unknown, input: Record<string, unknown>, vaultId?: number) {
    const r = this.#row(userId, policyId);
    if (r.archived_at !== null) throw new AccountError(409, "archived", "Policy đã lưu trữ, không sửa được.");
    const name = input.name === undefined ? r.name : (text(input.name, 60, "Tên policy", true) as string);
    if (name !== r.name && this.#nameTaken(userId, name, r.id))
      throw new AccountError(409, "duplicate", "Đã có policy cùng tên.");
    const description =
      input.description === undefined ? r.description : text(input.description, 300, "Mô tả");
    let newVersion: number | null = null;
    const now = this.#now();
    if (input.spec !== undefined) {
      const s = spec(input.spec);
      const latest = this.#latest(r.id);
      if (canonicalSpec(s) !== canonicalSpec(JSON.parse(latest.spec) as PolicySpec)) {
        newVersion = latest.version + 1;
        this.#db
          .prepare(
            "INSERT INTO policy_versions (policy_id, version, spec, note, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(r.id, newVersion, JSON.stringify(s), text(input.note, 300, "Ghi chú"), now);
      }
    }
    this.#db
      .prepare("UPDATE policies SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description, now, r.id);
    if (newVersion) this.#audit(userId, "policy_versioned", { policyId: r.id, version: newVersion });
    return { policy: this.get(userId, r.id, vaultId), newVersion };
  }

  /** Archive (the versions stay for history). Refused while an agent is assigned to it. */
  archive(userId: string, policyId: unknown) {
    const r = this.#row(userId, policyId);
    const inUse = this.#db
      .prepare(
        `SELECT 1 FROM policy_assignments a JOIN policy_versions pv ON pv.id = a.policy_version_id
         WHERE pv.policy_id = ? AND a.state = 'current'`,
      )
      .get(r.id);
    if (inUse)
      throw new AccountError(
        409,
        "in_use",
        "Policy đang được gán cho agent. Gán policy khác hoặc bỏ gán trước khi lưu trữ.",
      );
    this.#db
      .prepare("UPDATE policies SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(this.#now(), this.#now(), r.id);
    this.#audit(userId, "policy_archived", { policyId: r.id });
  }

  // ================================================================== assignments (per vault)

  #agent(v: VaultCtx, agentId: unknown): AgentRow {
    const row = this.#db
      .prepare("SELECT id, vault_id, name, address, status FROM agents WHERE id = ? AND vault_id = ?")
      .get(positiveId(agentId, "agent"), v.id) as AgentRow | undefined;
    if (!row) throw notFound("agent");
    return row;
  }

  #current(agentId: number): AssignmentRow | undefined {
    return this.#db
      .prepare("SELECT * FROM policy_assignments WHERE agent_id = ? AND state = 'current'")
      .get(agentId) as AssignmentRow | undefined;
  }

  #assignmentRow(v: VaultCtx, assignmentId: unknown): AssignmentRow & { agent: AgentRow } {
    const a = this.#db
      .prepare(
        `SELECT a.* FROM policy_assignments a JOIN agents ag ON ag.id = a.agent_id
         WHERE a.id = ? AND ag.vault_id = ?`,
      )
      .get(positiveId(assignmentId, "lần gán policy"), v.id) as AssignmentRow | undefined;
    if (!a) throw notFound("lần gán policy");
    return { ...a, agent: this.#agent(v, a.agent_id) };
  }

  #cancelDrafts(assignmentId: number) {
    this.#db
      .prepare(
        "UPDATE policy_changes SET status = 'cancelled', updated_at = ? WHERE assignment_id = ? AND status = 'draft'",
      )
      .run(this.#now(), assignmentId);
  }

  /** Assigns a policy version (default: the latest) to an agent of the vault; replaces its current one. */
  assign(v: VaultCtx, input: Record<string, unknown>) {
    const agent = this.#agent(v, input.agentId);
    if (agent.status === "retired")
      throw new AccountError(
        409,
        "agent_retired",
        "Agent đã ngừng dùng; đổi trạng thái trước khi gán policy.",
      );
    const p = this.#row(v.userId, input.policyId);
    if (p.archived_at !== null) throw new AccountError(409, "archived", "Policy đã lưu trữ.");
    const version =
      input.version === undefined
        ? this.#latest(p.id)
        : (this.#db
            .prepare("SELECT * FROM policy_versions WHERE policy_id = ? AND version = ?")
            .get(p.id, positiveId(input.version, "phiên bản")) as VersionRow | undefined);
    if (!version) throw notFound("phiên bản policy");
    const current = this.#current(agent.id);
    if (current?.policy_version_id === version.id) return this.assignment(v, current.id);
    const now = this.#now();
    this.#db.exec("BEGIN");
    try {
      if (current) {
        this.#cancelDrafts(current.id);
        this.#db
          .prepare("UPDATE policy_assignments SET state = 'ended', ended_at = ? WHERE id = ?")
          .run(now, current.id);
      }
      const res = this.#db
        .prepare(
          "INSERT INTO policy_assignments (agent_id, policy_version_id, state, created_at) VALUES (?, ?, 'current', ?)",
        )
        .run(agent.id, version.id, now);
      this.#db.exec("COMMIT");
      this.#audit(v.userId, "policy_assigned", {
        vault: v.address,
        agent: getAddress(agent.address),
        policyId: p.id,
        version: version.version,
      });
      return this.assignment(v, Number(res.lastInsertRowid));
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Ends the agent's current assignment. The vault keeps its state: to stop execution, revoke the agent. */
  unassign(v: VaultCtx, agentId: unknown) {
    const agent = this.#agent(v, agentId);
    const current = this.#current(agent.id);
    if (!current) throw notFound("policy đang gán cho agent này");
    this.#cancelDrafts(current.id);
    this.#db
      .prepare("UPDATE policy_assignments SET state = 'ended', ended_at = ? WHERE id = ?")
      .run(this.#now(), current.id);
    this.#audit(v.userId, "policy_unassigned", { vault: v.address, agent: getAddress(agent.address) });
  }

  assignment(v: VaultCtx, assignmentId: unknown) {
    const a = this.#assignmentRow(v, assignmentId);
    const version = this.#db
      .prepare("SELECT * FROM policy_versions WHERE id = ?")
      .get(a.policy_version_id) as VersionRow;
    const p = this.#db.prepare("SELECT * FROM policies WHERE id = ?").get(version.policy_id) as PolicyRow;
    const n = this.#naming(v.id);
    return {
      id: a.id,
      state: a.state,
      agent: {
        id: a.agent.id,
        name: a.agent.name,
        address: getAddress(a.agent.address),
        status: a.agent.status,
      },
      policy: { id: p.id, name: p.name, latestVersion: this.#latest(p.id).version },
      version: this.#version(version, n),
      createdAt: a.created_at,
      endedAt: a.ended_at,
    };
  }

  #enforcement(a: AssignmentRow & { agent: AgentRow }, chain: OnChainPolicy | null, n: Naming): Enforcement {
    if (!chain) return { state: "unknown" };
    const version = this.#db
      .prepare("SELECT spec FROM policy_versions WHERE id = ?")
      .get(a.policy_version_id) as {
      spec: string;
    };
    const plan = planChanges(JSON.parse(version.spec) as PolicySpec, chain, getAddress(a.agent.address), n);
    if (!plan.changes.length && !plan.blockers.length) return { state: "active", plan };
    const counts = this.#db
      .prepare(
        `SELECT SUM(status = 'draft') AS drafts, SUM(status = 'submitted') AS submitted
         FROM policy_changes WHERE assignment_id = ?`,
      )
      .get(a.id) as { drafts: number | null; submitted: number | null };
    return { state: "pending", plan, drafts: counts.drafts ?? 0, submitted: counts.submitted ?? 0 };
  }

  async #chain(v: VaultCtx): Promise<OnChainPolicy | null> {
    // An unreachable or rate-limited RPC: states become "unknown" instead of failing the page.
    return this.#o.chain.vaultPolicy(v.address).catch(() => null);
  }

  /**
   * Every agent of the vault with its current assignment and whether it is in force, plus today's spending
   * read from the vault. `chain: false` when the chain could not be read (states are then "unknown").
   */
  async overview(v: VaultCtx) {
    const chain = await this.#chain(v);
    const n = this.#naming(v.id);
    const agents = this.#db
      .prepare(
        "SELECT id, vault_id, name, address, status FROM agents WHERE vault_id = ? ORDER BY created_at",
      )
      .all(v.id) as AgentRow[];
    return {
      chain: chain !== null,
      onChain: chain
        ? {
            agent: chain.agent,
            paused: chain.paused,
            guardianSet: chain.guardian !== "0x0000000000000000000000000000000000000000",
            budgets: [
              ...chain.tokens.map((t) => ({
                token: t.token as Address | "native",
                symbol: n.asset(t.token).symbol,
                decimals: n.asset(t.token).decimals,
                dailyCap: t.dailyCap.toString(),
                spentToday: t.spentToday.toString(),
              })),
              {
                token: "native" as const,
                symbol: "AVAX",
                decimals: 18,
                dailyCap: chain.nativeDailyCap.toString(),
                spentToday: chain.nativeSpentToday.toString(),
              },
            ],
          }
        : null,
      agents: agents.map((ag) => {
        const current = this.#current(ag.id);
        if (!current)
          return {
            agent: { id: ag.id, name: ag.name, address: getAddress(ag.address), status: ag.status },
            isOnChainAgent: chain ? chain.agent.toLowerCase() === ag.address : null,
            assignment: null,
            enforcement: null,
          };
        const e = this.#enforcement({ ...current, agent: ag }, chain, n);
        return {
          agent: { id: ag.id, name: ag.name, address: getAddress(ag.address), status: ag.status },
          isOnChainAgent: chain ? chain.agent.toLowerCase() === ag.address : null,
          assignment: this.assignment(v, current.id),
          enforcement: e,
        };
      }),
    };
  }

  /** The owner transactions that would put the assignment in force, from the vault's current state. */
  async plan(v: VaultCtx, assignmentId: unknown) {
    const a = this.#assignmentRow(v, assignmentId);
    if (a.state !== "current") throw new AccountError(409, "ended", "Lần gán này đã kết thúc.");
    const chain = await this.#o.chain.vaultPolicy(v.address);
    return {
      assignment: this.assignment(v, a.id),
      enforcement: this.#enforcement(a, chain, this.#naming(v.id)),
    };
  }

  /**
   * Drafts the owner transactions of the plan (replacing unsent drafts of this assignment). The owner signs each
   * one in the Thay đổi on-chain flow; the server verifies them on chain as for any policy change.
   */
  async apply(v: VaultCtx, assignmentId: unknown) {
    const a = this.#assignmentRow(v, assignmentId);
    if (a.state !== "current") throw new AccountError(409, "ended", "Lần gán này đã kết thúc.");
    const submitted = this.#db
      .prepare("SELECT 1 FROM policy_changes WHERE assignment_id = ? AND status = 'submitted'")
      .get(a.id);
    if (submitted)
      throw new AccountError(
        409,
        "changes_pending",
        "Còn giao dịch đã gửi đang chờ xác nhận trên chain. Đợi xác nhận rồi lập lại kế hoạch.",
      );
    if (a.agent.status === "retired") throw new AccountError(409, "agent_retired", "Agent đã ngừng dùng.");
    const chain = await this.#o.chain.vaultPolicy(v.address);
    const n = this.#naming(v.id);
    const e = this.#enforcement(a, chain, n);
    if (e.state !== "pending") return { changes: [], enforcement: e };
    if (e.plan.blockers.length) throw new AccountError(409, "blocked", e.plan.blockers.join(" "));
    this.#cancelDrafts(a.id);
    const changes = e.plan.changes.map((c) =>
      this.#o.workspace.createPolicyChange(v, { kind: c.kind, params: c.params, note: c.reason }, a.id),
    );
    this.#audit(v.userId, "policy_apply_drafted", {
      vault: v.address,
      assignmentId: a.id,
      count: changes.length,
    });
    return { changes, enforcement: this.#enforcement(a, chain, n) };
  }

  /** For the agent API: the agent's current assignment and whether it is in force (null when none). */
  async forAgent(v: VaultCtx, agentId: number) {
    const ag = this.#agent(v, agentId);
    const current = this.#current(ag.id);
    if (!current) return { assignment: null, enforcement: null, chain: await this.#chain(v) };
    const chain = await this.#chain(v);
    return {
      assignment: this.assignment(v, current.id),
      enforcement: this.#enforcement({ ...current, agent: ag }, chain, this.#naming(v.id)),
      chain,
    };
  }
}
