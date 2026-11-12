// Vault workspace: the off-chain business logic around a vault the user has linked (Accounts.linkVault).
//
// Principles (hackathon rules 2, 3, 5):
// - The chain is the authority. Allowlists, the current agent, caps and ownership are read live from the
//   AgentVault; nothing here can change them. Policy changes are only *prepared* here: the owner signs and
//   sends them from their own wallet, and the server then verifies the transaction on chain.
// - Off-chain data is the owner's own metadata: agent registry, address book, alert rules, notifications,
//   reviews of Guardian checks. No keys, no balances, nothing personal on chain.
// - Every operation is scoped to a vault linked to the caller; anything else is a 404.
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { agentVaultAbi } from "@guardian402/shared";
import { looksLike } from "../lib/lookalike";
import { AccountError } from "./accounts";
import type { Db } from "./db";
import { sameAddress, type ChainPort, type GuardianCheck, type GuardianPort, type RiskLevel } from "./ports";

export const LIMITS = { agents: 20, contacts: 200, alertRules: 20, notifications: 100 } as const;
const MAX_UINT256 = 2n ** 256n - 1n;
const DAY_MS = 86_400_000;

export type WorkspaceOptions = {
  chain: ChainPort;
  guardian: GuardianPort;
  chainId: number;
  /** Token whose daily cap the cap_usage alerts watch (USDC). */
  capToken: Address;
  /** Known contracts of the deployment (router, tokens, oracle…), for the lookalike check. */
  known: { name: string; address: Address }[];
  now?: () => number;
};

export type VaultCtx = { id: number; userId: string; address: Address };

// ------------------------------------------------------------------ validation helpers

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

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value))
    throw bad("bad_address", `${field} không phải địa chỉ hợp lệ.`);
  return getAddress(value);
}

function uint(value: unknown, field: string, max = MAX_UINT256): bigint {
  const s = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof s !== "string" || !/^\d{1,78}$/.test(s))
    throw bad("bad_amount", `${field} phải là số nguyên ≥ 0 (đơn vị gốc).`);
  const n = BigInt(s);
  if (n > max) throw bad("bad_amount", `${field} quá lớn.`);
  return n;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw bad("bad_field", `${field} phải là true/false.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], field: string, fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T))
    throw bad("bad_field", `${field} phải là một trong: ${options.join(", ")}.`);
  return value as T;
}

function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound("mục này");
  return n;
}

export { looksLike };

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const RISK_VI: Record<RiskLevel, string> = { LOW: "THẤP", MEDIUM: "TRUNG BÌNH", HIGH: "CAO" };
const shortId = (s: string) => `${s.slice(0, 10)}…`;

// ------------------------------------------------------------------ policy change kinds

export const POLICY_KINDS = [
  "pause",
  "unpause",
  "set_agent",
  "revoke_agent",
  "allow_recipient",
  "allow_target",
  "allow_selector",
  "token_policy",
  "native_policy",
  "max_agent_risk",
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

type Prepared = { params: Record<string, unknown>; fn: string; args: unknown[]; warnings: string[] };

/** Validates the parameters of a policy change and maps it to the AgentVault call the owner must sign. */
function preparePolicy(
  kind: PolicyKind,
  raw: Record<string, unknown>,
  vault: Address,
  ownerWallets: Address[],
): Prepared {
  const warnings: string[] = [];
  switch (kind) {
    case "pause":
      return { params: {}, fn: "pause", args: [], warnings };
    case "unpause":
      return { params: {}, fn: "unpause", args: [], warnings };
    case "revoke_agent":
      return { params: {}, fn: "setAgent", args: [zeroAddress], warnings };
    case "set_agent": {
      const agent = address(raw.agent, "agent");
      if (agent === zeroAddress) throw bad("bad_address", "Dùng revoke_agent để thu hồi agent.");
      if (sameAddress(agent, vault)) throw bad("bad_address", "Vault không thể là agent của chính nó.");
      if (ownerWallets.some((w) => sameAddress(w, agent)))
        warnings.push(
          "Agent trùng một ví chủ: khoá agent nằm trong tiến trình AI, đừng dùng ví chủ làm agent.",
        );
      return { params: { agent }, fn: "setAgent", args: [agent], warnings };
    }
    case "allow_recipient":
    case "allow_target": {
      const a = address(raw.address, "address");
      const allowed = bool(raw.allowed, "allowed");
      if (sameAddress(a, vault)) throw bad("bad_address", "Không thể thêm chính két vào danh sách.");
      return {
        params: { address: a, allowed },
        fn: kind === "allow_recipient" ? "setAllowedRecipient" : "setAllowedTarget",
        args: [a, allowed],
        warnings,
      };
    }
    case "allow_selector": {
      const target = address(raw.target, "target");
      if (sameAddress(target, vault)) throw bad("bad_address", "Không thể cho phép gọi chính két.");
      if (typeof raw.selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(raw.selector))
        throw bad("bad_field", "selector phải là 4 byte (0x + 8 ký tự hex).");
      const selector = raw.selector.toLowerCase() as Hex;
      const allowed = bool(raw.allowed, "allowed");
      return {
        params: { target, selector, allowed },
        fn: "setAllowedSelector",
        args: [target, selector, allowed],
        warnings,
      };
    }
    case "token_policy": {
      const token = address(raw.token, "token");
      if (token === zeroAddress || sameAddress(token, vault))
        throw bad("bad_address", "Token không hợp lệ (dùng native_policy cho AVAX).");
      const tracked = bool(raw.tracked, "tracked");
      const dailyCap = uint(raw.dailyCap, "dailyCap");
      const maxApproval = uint(raw.maxApproval, "maxApproval");
      const verdictThreshold = uint(raw.verdictThreshold, "verdictThreshold");
      if (tracked && verdictThreshold > dailyCap)
        warnings.push(
          "Ngưỡng cần verdict lớn hơn hạn mức/ngày: mọi khoản chi hợp lệ sẽ không cần chữ ký Guardian.",
        );
      if (!tracked) warnings.push("Bỏ theo dõi token: két sẽ không còn giới hạn chi tiêu token này.");
      return {
        params: {
          token,
          tracked,
          dailyCap: dailyCap.toString(),
          maxApproval: maxApproval.toString(),
          verdictThreshold: verdictThreshold.toString(),
        },
        fn: "setTokenPolicy",
        args: [token, tracked, dailyCap, maxApproval, verdictThreshold],
        warnings,
      };
    }
    case "native_policy": {
      const dailyCap = uint(raw.dailyCap, "dailyCap");
      const verdictThreshold = uint(raw.verdictThreshold, "verdictThreshold");
      if (verdictThreshold > dailyCap)
        warnings.push("Ngưỡng cần verdict lớn hơn hạn mức/ngày: chi AVAX sẽ không cần chữ ký Guardian.");
      return {
        params: { dailyCap: dailyCap.toString(), verdictThreshold: verdictThreshold.toString() },
        fn: "setNativePolicy",
        args: [dailyCap, verdictThreshold],
        warnings,
      };
    }
    case "max_agent_risk": {
      const risk = Number(uint(raw.risk, "risk", 2n));
      if (risk > 0)
        warnings.push(
          risk === 2
            ? "Agent có thể chạy cả giao dịch Guardian chấm CAO."
            : "Agent có thể chạy giao dịch Guardian chấm TRUNG BÌNH.",
        );
      return { params: { risk }, fn: "setMaxAgentRisk", args: [risk], warnings };
    }
  }
}

// ------------------------------------------------------------------ rows

type AgentRow = {
  id: number;
  name: string;
  description: string | null;
  address: string;
  status: string;
  created_at: number;
  updated_at: number;
};
type ContactRow = {
  id: number;
  name: string;
  address: string;
  kind: string;
  note: string | null;
  created_at: number;
  updated_at: number;
};
type PolicyRow = {
  id: number;
  kind: PolicyKind;
  params: string;
  calldata: Hex;
  status: "draft" | "submitted" | "confirmed" | "failed" | "cancelled";
  tx_hash: Hex | null;
  note: string | null;
  assignment_id: number | null;
  created_at: number;
  updated_at: number;
  confirmed_at: number | null;
};
type RuleRow = {
  id: number;
  name: string;
  kind: "risk" | "rule" | "cap_usage";
  min_risk: "MEDIUM" | "HIGH" | null;
  rule_id: string | null;
  cap_percent: number | null;
  enabled: number;
  created_at: number;
  updated_at: number;
};
type NotificationRow = {
  id: number;
  alert_rule_id: number | null;
  title: string;
  body: string;
  check_id: string | null;
  created_at: number;
  read_at: number | null;
};
type ReviewRow = { check_id: string; status: string; note: string | null; updated_at: number };

// ------------------------------------------------------------------ service

export class Workspace {
  readonly #db: Db;
  readonly #o: WorkspaceOptions;
  readonly #now: () => number;

  constructor(db: Db, opts: WorkspaceOptions) {
    this.#db = db;
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
  }

  /** The caller's link to `rawVault`, or 404 (never reveals whether someone else linked it). */
  vault(userId: string, rawVault: string): VaultCtx {
    if (!isAddress(rawVault)) throw bad("bad_address", "Địa chỉ két không hợp lệ.");
    const row = this.#db
      .prepare("SELECT id FROM vaults WHERE user_id = ? AND chain_id = ? AND address = ?")
      .get(userId, this.#o.chainId, rawVault.toLowerCase()) as { id: number } | undefined;
    if (!row) throw notFound("vault trong tài khoản của bạn");
    return { id: row.id, userId, address: getAddress(rawVault) };
  }

  #wallets(userId: string): Address[] {
    return (
      this.#db.prepare("SELECT address FROM wallets WHERE user_id = ?").all(userId) as { address: string }[]
    ).map((w) => getAddress(w.address));
  }

  #audit(userId: string, event: string, detail: Record<string, unknown>) {
    this.#db
      .prepare("INSERT INTO audit_events (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, event, JSON.stringify(detail), this.#now());
  }

  #count(table: string, vaultId: number): number {
    return (
      this.#db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE vault_id = ?`).get(vaultId) as { n: number }
    ).n;
  }

  // ================================================================== agents

  async listAgents(v: VaultCtx) {
    const onChainAgent = await this.#o.chain.vaultAgent(v.address);
    const rows = this.#db
      .prepare("SELECT * FROM agents WHERE vault_id = ? ORDER BY created_at")
      .all(v.id) as AgentRow[];
    return {
      onChainAgent: onChainAgent === zeroAddress ? null : onChainAgent,
      agents: rows.map((r) => ({ ...this.#agent(r), isOnChainAgent: sameAddress(r.address, onChainAgent) })),
    };
  }

  #agent(r: AgentRow) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      address: getAddress(r.address),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createAgent(v: VaultCtx, input: Record<string, unknown>) {
    const name = text(input.name, 60, "Tên agent", true) as string;
    const addr = address(input.address, "Địa chỉ agent");
    if (addr === zeroAddress || sameAddress(addr, v.address))
      throw bad("bad_address", "Địa chỉ agent không hợp lệ.");
    if (this.#wallets(v.userId).some((w) => sameAddress(w, addr)))
      throw new AccountError(
        409,
        "owner_as_agent",
        "Ví chủ không được làm agent: agent phải là một khoá riêng của tiến trình AI.",
      );
    if (this.#count("agents", v.id) >= LIMITS.agents)
      throw new AccountError(409, "limit", `Tối đa ${LIMITS.agents} agent cho một két.`);
    if (
      this.#db
        .prepare("SELECT 1 FROM agents WHERE vault_id = ? AND address = ?")
        .get(v.id, addr.toLowerCase())
    )
      throw new AccountError(409, "duplicate", "Agent này đã có trong danh sách.");
    const now = this.#now();
    const res = this.#db
      .prepare(
        `INSERT INTO agents (vault_id, name, description, address, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(v.id, name, text(input.description, 300, "Mô tả nhiệm vụ"), addr.toLowerCase(), now, now);
    this.#audit(v.userId, "agent_added", { vault: v.address, address: addr });
    return this.#agent(
      this.#db.prepare("SELECT * FROM agents WHERE id = ?").get(Number(res.lastInsertRowid)) as AgentRow,
    );
  }

  updateAgent(v: VaultCtx, agentId: unknown, input: Record<string, unknown>) {
    const row = this.#db
      .prepare("SELECT * FROM agents WHERE id = ? AND vault_id = ?")
      .get(id(agentId), v.id) as AgentRow | undefined;
    if (!row) throw notFound("agent");
    if (input.address !== undefined && !sameAddress(String(input.address), row.address))
      throw bad("immutable", "Không đổi được địa chỉ agent; hãy xoá và thêm agent mới.");
    const next = {
      name: input.name === undefined ? row.name : (text(input.name, 60, "Tên agent", true) as string),
      description:
        input.description === undefined ? row.description : text(input.description, 300, "Mô tả nhiệm vụ"),
      status:
        input.status === undefined
          ? row.status
          : oneOf(input.status, ["active", "paused", "retired"] as const, "status"),
    };
    this.#db
      .prepare("UPDATE agents SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.description, next.status, this.#now(), row.id);
    return this.#agent(this.#db.prepare("SELECT * FROM agents WHERE id = ?").get(row.id) as AgentRow);
  }

  async deleteAgent(v: VaultCtx, agentId: unknown) {
    const row = this.#db
      .prepare("SELECT * FROM agents WHERE id = ? AND vault_id = ?")
      .get(id(agentId), v.id) as AgentRow | undefined;
    if (!row) throw notFound("agent");
    if (sameAddress(row.address, await this.#o.chain.vaultAgent(v.address)))
      throw new AccountError(
        409,
        "agent_active_on_chain",
        "Agent này đang là agent của két trên chain. Hãy thu hồi agent (revoke_agent) trước khi xoá.",
      );
    this.#db.prepare("DELETE FROM agents WHERE id = ?").run(row.id);
    this.#audit(v.userId, "agent_removed", { vault: v.address, address: getAddress(row.address) });
  }

  // ================================================================== contacts

  async listContacts(v: VaultCtx) {
    const rows = this.#db
      .prepare("SELECT * FROM contacts WHERE vault_id = ? ORDER BY name COLLATE NOCASE")
      .all(v.id) as ContactRow[];
    // Allowlist state is on-chain; read it per contact (the address book is small, capped at LIMITS.contacts).
    const flags = await Promise.all(
      rows.map((r) => this.#o.chain.allowlisted(v.address, getAddress(r.address))),
    );
    return rows.map((r, i) => ({
      ...this.#contact(r),
      allowlisted: flags[i] ?? { recipient: false, target: false },
    }));
  }

  #contact(r: ContactRow) {
    return {
      id: r.id,
      name: r.name,
      address: getAddress(r.address),
      kind: r.kind,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createContact(v: VaultCtx, input: Record<string, unknown>) {
    const name = text(input.name, 60, "Tên liên hệ", true) as string;
    const addr = address(input.address, "Địa chỉ");
    if (addr === zeroAddress || sameAddress(addr, v.address))
      throw bad("bad_address", "Không lưu được địa chỉ này vào danh bạ.");
    if (this.#count("contacts", v.id) >= LIMITS.contacts)
      throw new AccountError(409, "limit", `Tối đa ${LIMITS.contacts} liên hệ cho một két.`);
    if (
      this.#db
        .prepare("SELECT 1 FROM contacts WHERE vault_id = ? AND address = ?")
        .get(v.id, addr.toLowerCase())
    )
      throw new AccountError(409, "duplicate", "Địa chỉ này đã có trong danh bạ.");
    // Address poisoning: refuse an address that mimics one the owner already trusts, unless explicitly confirmed.
    const trusted = [
      ...(this.#db.prepare("SELECT name, address FROM contacts WHERE vault_id = ?").all(v.id) as {
        name: string;
        address: string;
      }[]),
      ...this.#o.known,
      ...this.#wallets(v.userId).map((a) => ({ name: "ví của bạn", address: a })),
      { name: "vault", address: v.address },
    ];
    const mimic = trusted.find((t) => looksLike(addr, t.address));
    if (mimic && input.confirmLookalike !== true)
      throw new AccountError(
        409,
        "lookalike",
        `Địa chỉ này trông giống ${mimic.name} (${getAddress(mimic.address)}) nhưng khác: dấu hiệu address poisoning. Kiểm tra lại từng ký tự; nếu chắc chắn đúng, gửi kèm confirmLookalike: true.`,
      );
    const now = this.#now();
    const res = this.#db
      .prepare(
        `INSERT INTO contacts (vault_id, name, address, kind, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        v.id,
        name,
        addr.toLowerCase(),
        oneOf(input.kind, ["recipient", "router", "treasury", "other"] as const, "kind", "recipient"),
        text(input.note, 300, "Ghi chú"),
        now,
        now,
      );
    this.#audit(v.userId, mimic ? "contact_added_lookalike" : "contact_added", {
      vault: v.address,
      address: addr,
      ...(mimic ? { looksLike: getAddress(mimic.address) } : {}),
    });
    return this.#contact(
      this.#db.prepare("SELECT * FROM contacts WHERE id = ?").get(Number(res.lastInsertRowid)) as ContactRow,
    );
  }

  updateContact(v: VaultCtx, contactId: unknown, input: Record<string, unknown>) {
    const row = this.#db
      .prepare("SELECT * FROM contacts WHERE id = ? AND vault_id = ?")
      .get(id(contactId), v.id) as ContactRow | undefined;
    if (!row) throw notFound("liên hệ");
    if (input.address !== undefined && !sameAddress(String(input.address), row.address))
      throw bad(
        "immutable",
        "Không đổi được địa chỉ; hãy xoá và thêm liên hệ mới (để kiểm tra địa chỉ nhái).",
      );
    this.#db
      .prepare("UPDATE contacts SET name = ?, kind = ?, note = ?, updated_at = ? WHERE id = ?")
      .run(
        input.name === undefined ? row.name : text(input.name, 60, "Tên liên hệ", true),
        input.kind === undefined
          ? row.kind
          : oneOf(input.kind, ["recipient", "router", "treasury", "other"] as const, "kind"),
        input.note === undefined ? row.note : text(input.note, 300, "Ghi chú"),
        this.#now(),
        row.id,
      );
    return this.#contact(this.#db.prepare("SELECT * FROM contacts WHERE id = ?").get(row.id) as ContactRow);
  }

  deleteContact(v: VaultCtx, contactId: unknown) {
    const res = this.#db
      .prepare("DELETE FROM contacts WHERE id = ? AND vault_id = ?")
      .run(id(contactId), v.id);
    if (res.changes !== 1) throw notFound("liên hệ");
  }

  // ================================================================== policy changes

  listPolicyChanges(v: VaultCtx) {
    return (
      this.#db
        .prepare("SELECT * FROM policy_changes WHERE vault_id = ? ORDER BY created_at DESC LIMIT 100")
        .all(v.id) as PolicyRow[]
    ).map((r) => this.#policy(v, r));
  }

  #policy(v: VaultCtx, r: PolicyRow) {
    return {
      id: r.id,
      kind: r.kind,
      params: JSON.parse(r.params) as Record<string, unknown>,
      status: r.status,
      note: r.note,
      txHash: r.tx_hash,
      assignmentId: r.assignment_id,
      // What the owner's wallet must send: exactly this, to the vault, with no value.
      transaction: { to: v.address, data: r.calldata, value: "0" },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      confirmedAt: r.confirmed_at,
    };
  }

  #policyRow(v: VaultCtx, changeId: unknown): PolicyRow {
    const row = this.#db
      .prepare("SELECT * FROM policy_changes WHERE id = ? AND vault_id = ?")
      .get(id(changeId), v.id) as PolicyRow | undefined;
    if (!row) throw notFound("thay đổi chính sách");
    return row;
  }

  /** `assignmentId` is set only by the policy service, when it drafts the changes that apply an assignment. */
  createPolicyChange(v: VaultCtx, input: Record<string, unknown>, assignmentId: number | null = null) {
    const kind = oneOf(input.kind, POLICY_KINDS, "kind");
    const raw =
      input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : {};
    const p = preparePolicy(kind, raw, v.address, this.#wallets(v.userId));
    const calldata = encodeFunctionData({
      abi: agentVaultAbi,
      functionName: p.fn as never,
      args: p.args as never,
    });
    const now = this.#now();
    const res = this.#db
      .prepare(
        `INSERT INTO policy_changes
           (vault_id, kind, params, calldata, status, note, assignment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .run(
        v.id,
        kind,
        JSON.stringify(p.params),
        calldata,
        text(input.note, 300, "Ghi chú"),
        assignmentId,
        now,
        now,
      );
    this.#audit(v.userId, "policy_drafted", { vault: v.address, kind });
    const row = this.#policyRow(v, Number(res.lastInsertRowid));
    return { ...this.#policy(v, row), warnings: p.warnings };
  }

  /** Drafts only: change params and/or note; the calldata is rebuilt. */
  updatePolicyChange(v: VaultCtx, changeId: unknown, input: Record<string, unknown>) {
    const row = this.#policyRow(v, changeId);
    if (row.status !== "draft")
      throw new AccountError(409, "not_draft", "Chỉ sửa được bản nháp; thay đổi này đã gửi lên chain.");
    let params = row.params;
    let calldata = row.calldata;
    let warnings: string[] = [];
    if (input.params !== undefined) {
      const raw =
        input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : {};
      const p = preparePolicy(row.kind, raw, v.address, this.#wallets(v.userId));
      params = JSON.stringify(p.params);
      calldata = encodeFunctionData({
        abi: agentVaultAbi,
        functionName: p.fn as never,
        args: p.args as never,
      });
      warnings = p.warnings;
    }
    const note = input.note === undefined ? row.note : text(input.note, 300, "Ghi chú");
    this.#db
      .prepare("UPDATE policy_changes SET params = ?, calldata = ?, note = ?, updated_at = ? WHERE id = ?")
      .run(params, calldata, note, this.#now(), row.id);
    return { ...this.#policy(v, this.#policyRow(v, row.id)), warnings };
  }

  cancelPolicyChange(v: VaultCtx, changeId: unknown) {
    const row = this.#policyRow(v, changeId);
    if (row.status !== "draft")
      throw new AccountError(
        409,
        "not_draft",
        "Chỉ huỷ được bản nháp; giao dịch đã gửi không thể huỷ ở đây.",
      );
    this.#db
      .prepare("UPDATE policy_changes SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(this.#now(), row.id);
    return this.#policy(v, this.#policyRow(v, row.id));
  }

  /**
   * The owner sent the transaction from their wallet: verify it on chain. It must go to this vault, carry
   * exactly the prepared calldata, come from one of the caller's verified wallets, and succeed. Pending stays
   * `submitted`; call refreshPolicyChange later.
   */
  async submitPolicyChange(v: VaultCtx, changeId: unknown, input: Record<string, unknown>) {
    const row = this.#policyRow(v, changeId);
    if (row.status !== "draft")
      throw new AccountError(409, "not_draft", "Thay đổi này đã được gửi trước đó.");
    const hash = typeof input.txHash === "string" ? input.txHash.toLowerCase() : "";
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw bad("bad_tx", "Mã giao dịch không hợp lệ.");
    if (this.#db.prepare("SELECT 1 FROM policy_changes WHERE tx_hash = ?").get(hash))
      throw new AccountError(409, "tx_reused", "Giao dịch này đã được dùng cho một thay đổi khác.");
    const status = await this.#verifyTx(v, row, hash as Hex);
    const now = this.#now();
    this.#db
      .prepare(
        "UPDATE policy_changes SET status = ?, tx_hash = ?, updated_at = ?, confirmed_at = ? WHERE id = ?",
      )
      .run(status, hash, now, status === "confirmed" ? now : null, row.id);
    this.#audit(v.userId, `policy_${status}`, { vault: v.address, kind: row.kind, tx: hash });
    return this.#policy(v, this.#policyRow(v, row.id));
  }

  /** Re-checks a submitted change (pending when it was submitted). */
  async refreshPolicyChange(v: VaultCtx, changeId: unknown) {
    const row = this.#policyRow(v, changeId);
    if (row.status !== "submitted" || !row.tx_hash) return this.#policy(v, row);
    const status = await this.#verifyTx(v, row, row.tx_hash);
    if (status !== "submitted") {
      const now = this.#now();
      this.#db
        .prepare("UPDATE policy_changes SET status = ?, updated_at = ?, confirmed_at = ? WHERE id = ?")
        .run(status, now, status === "confirmed" ? now : null, row.id);
      this.#audit(v.userId, `policy_${status}`, { vault: v.address, kind: row.kind, tx: row.tx_hash });
    }
    return this.#policy(v, this.#policyRow(v, row.id));
  }

  async #verifyTx(v: VaultCtx, row: PolicyRow, hash: Hex): Promise<"submitted" | "confirmed" | "failed"> {
    const tx = await this.#o.chain.transaction(hash);
    const reject = (code: string, message: string) => new AccountError(422, code, message);
    if (!tx.found)
      throw reject(
        "tx_not_found",
        "Chưa thấy giao dịch này trên chain. Đợi vài giây rồi gửi lại mã giao dịch.",
      );
    if (!tx.to || !sameAddress(tx.to, v.address))
      throw reject("tx_wrong_vault", "Giao dịch không gửi tới két này.");
    if (tx.input.toLowerCase() !== row.calldata.toLowerCase())
      throw reject("tx_wrong_call", "Giao dịch không khớp với thay đổi đã soạn (dữ liệu gọi hàm khác).");
    if (!this.#wallets(v.userId).some((w) => sameAddress(w, tx.from)))
      throw reject("tx_wrong_sender", "Giao dịch được gửi từ một ví không thuộc tài khoản của bạn.");
    return tx.status === "success" ? "confirmed" : tx.status === "reverted" ? "failed" : "submitted";
  }

  // ================================================================== alerts and notifications

  listAlertRules(v: VaultCtx) {
    return (
      this.#db
        .prepare("SELECT * FROM alert_rules WHERE vault_id = ? ORDER BY created_at")
        .all(v.id) as RuleRow[]
    ).map((r) => this.#rule(r));
  }

  #rule(r: RuleRow) {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      minRisk: r.min_risk,
      ruleId: r.rule_id,
      capPercent: r.cap_percent,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #ruleFields(input: Record<string, unknown>, kind: RuleRow["kind"]) {
    return {
      min_risk: kind === "risk" ? oneOf(input.minRisk, ["MEDIUM", "HIGH"] as const, "minRisk") : null,
      rule_id:
        kind === "rule"
          ? (() => {
              const r = text(input.ruleId, 40, "ruleId", true) as string;
              if (!/^[A-Z_]+$/.test(r)) throw bad("bad_field", "ruleId là mã luật, ví dụ ADDRESS_POISONING.");
              return r;
            })()
          : null,
      cap_percent: kind === "cap_usage" ? Number(uint(input.capPercent, "capPercent", 100n)) || null : null,
    };
  }

  createAlertRule(v: VaultCtx, input: Record<string, unknown>) {
    const kind = oneOf(input.kind, ["risk", "rule", "cap_usage"] as const, "kind");
    const name = text(input.name, 60, "Tên cảnh báo", true) as string;
    const f = this.#ruleFields(input, kind);
    if (kind === "cap_usage" && !f.cap_percent) throw bad("bad_amount", "capPercent phải từ 1 đến 100.");
    if (this.#count("alert_rules", v.id) >= LIMITS.alertRules)
      throw new AccountError(409, "limit", `Tối đa ${LIMITS.alertRules} cảnh báo cho một két.`);
    const now = this.#now();
    const res = this.#db
      .prepare(
        `INSERT INTO alert_rules (vault_id, name, kind, min_risk, rule_id, cap_percent, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.id, name, kind, f.min_risk, f.rule_id, f.cap_percent, input.enabled === false ? 0 : 1, now, now);
    return this.#rule(
      this.#db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(Number(res.lastInsertRowid)) as RuleRow,
    );
  }

  updateAlertRule(v: VaultCtx, ruleId: unknown, input: Record<string, unknown>) {
    const row = this.#db
      .prepare("SELECT * FROM alert_rules WHERE id = ? AND vault_id = ?")
      .get(id(ruleId), v.id) as RuleRow | undefined;
    if (!row) throw notFound("cảnh báo");
    if (input.kind !== undefined && input.kind !== row.kind)
      throw bad("immutable", "Không đổi được loại cảnh báo; hãy tạo cảnh báo mới.");
    const merged = {
      minRisk: input.minRisk ?? row.min_risk ?? undefined,
      ruleId: input.ruleId ?? row.rule_id ?? undefined,
      capPercent: input.capPercent ?? row.cap_percent ?? undefined,
    };
    const f = this.#ruleFields(merged, row.kind);
    if (row.kind === "cap_usage" && !f.cap_percent) throw bad("bad_amount", "capPercent phải từ 1 đến 100.");
    this.#db
      .prepare(
        `UPDATE alert_rules SET name = ?, min_risk = ?, rule_id = ?, cap_percent = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name === undefined ? row.name : text(input.name, 60, "Tên cảnh báo", true),
        f.min_risk,
        f.rule_id,
        f.cap_percent,
        input.enabled === undefined ? row.enabled : bool(input.enabled, "enabled") ? 1 : 0,
        this.#now(),
        row.id,
      );
    return this.#rule(this.#db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(row.id) as RuleRow);
  }

  deleteAlertRule(v: VaultCtx, ruleId: unknown) {
    const res = this.#db
      .prepare("DELETE FROM alert_rules WHERE id = ? AND vault_id = ?")
      .run(id(ruleId), v.id);
    if (res.changes !== 1) throw notFound("cảnh báo");
  }

  /**
   * Evaluates the enabled rules: risk/rule rules against the vault's Guardian checks made after the rule was
   * created, cap_usage against today's on-chain cap usage. Idempotent (one notification per check or per day
   * and rule). A Guardian or RPC outage is reported, not thrown, so notifications stay readable.
   */
  async syncAlerts(v: VaultCtx): Promise<{ created: number; guardian: boolean; chain: boolean }> {
    const rules = this.#db
      .prepare("SELECT * FROM alert_rules WHERE vault_id = ? AND enabled = 1")
      .all(v.id) as RuleRow[];
    let created = 0;
    let guardianOk = true;
    let chainOk = true;
    const insert = this.#db.prepare(
      `INSERT OR IGNORE INTO notifications (vault_id, alert_rule_id, dedupe_key, title, body, check_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const add = (rule: RuleRow, key: string, title: string, body: string, checkId: string | null) => {
      created += Number(
        insert.run(v.id, rule.id, `r${rule.id}:${key}`, title, body, checkId, this.#now()).changes,
      );
    };

    const checkRules = rules.filter((r) => r.kind !== "cap_usage");
    if (checkRules.length) {
      let checks: GuardianCheck[] = [];
      try {
        checks = (await this.#o.guardian.recentChecks(200, v.address)).filter((c) =>
          sameAddress(c.vault, v.address),
        );
      } catch {
        guardianOk = false;
      }
      for (const c of checks)
        for (const r of checkRules) {
          if (c.createdAt < r.created_at) continue;
          if (r.kind === "risk" && r.min_risk && RISK_RANK[c.risk] >= RISK_RANK[r.min_risk])
            add(
              r,
              c.checkId,
              `Guardian chấm rủi ro ${RISK_VI[c.risk]} (${c.score}/100)`,
              `Kiểm tra ${shortId(c.checkId)}${c.ruleIds.length ? ` · luật: ${c.ruleIds.join(", ")}` : ""}`,
              c.checkId,
            );
          if (r.kind === "rule" && r.rule_id && c.ruleIds.includes(r.rule_id))
            add(
              r,
              c.checkId,
              `Luật ${r.rule_id} vừa kích hoạt`,
              `Kiểm tra ${shortId(c.checkId)} · rủi ro ${RISK_VI[c.risk]}`,
              c.checkId,
            );
        }
    }

    const capRules = rules.filter((r) => r.kind === "cap_usage");
    if (capRules.length) {
      try {
        const usage = await this.#o.chain.capUsage(v.address, this.#o.capToken);
        if (usage && usage.dailyCap > 0n) {
          const used = usage.dailyCap > usage.remaining ? usage.dailyCap - usage.remaining : 0n;
          const percent = Number((used * 100n) / usage.dailyCap);
          const day = Math.floor(this.#now() / DAY_MS); // the vault counts days the same way (block.timestamp / 1 days)
          for (const r of capRules)
            if (r.cap_percent && percent >= r.cap_percent)
              add(
                r,
                `day:${day}`,
                `Đã dùng ${percent}% hạn mức hôm nay`,
                `Ngưỡng cảnh báo ${r.cap_percent}%`,
                null,
              );
        }
      } catch {
        chainOk = false;
      }
    }
    // Keep the table bounded per vault.
    this.#db
      .prepare(
        `DELETE FROM notifications WHERE vault_id = ? AND id NOT IN
           (SELECT id FROM notifications WHERE vault_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .run(v.id, v.id, LIMITS.notifications);
    return { created, guardian: guardianOk, chain: chainOk };
  }

  listNotifications(v: VaultCtx, unreadOnly = false) {
    const rows = this.#db
      .prepare(
        `SELECT * FROM notifications WHERE vault_id = ? ${unreadOnly ? "AND read_at IS NULL" : ""}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(v.id, LIMITS.notifications) as NotificationRow[];
    const unread = (
      this.#db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE vault_id = ? AND read_at IS NULL")
        .get(v.id) as {
        n: number;
      }
    ).n;
    return {
      unread,
      notifications: rows.map((n) => ({
        id: n.id,
        alertRuleId: n.alert_rule_id,
        title: n.title,
        body: n.body,
        checkId: n.check_id,
        createdAt: n.created_at,
        readAt: n.read_at,
      })),
    };
  }

  markRead(v: VaultCtx, input: Record<string, unknown>) {
    const now = this.#now();
    if (input.all === true) {
      const res = this.#db
        .prepare("UPDATE notifications SET read_at = ? WHERE vault_id = ? AND read_at IS NULL")
        .run(now, v.id);
      return { updated: Number(res.changes) };
    }
    if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 100)
      throw bad("bad_field", "Gửi ids (1–100 mã) hoặc all: true.");
    const stmt = this.#db.prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND vault_id = ? AND read_at IS NULL",
    );
    let updated = 0;
    for (const n of input.ids) updated += Number(stmt.run(now, id(n), v.id).changes);
    return { updated };
  }

  // ================================================================== Guardian checks and reviews

  /** The vault's recent Guardian checks with the owner's review of each. */
  async listChecks(v: VaultCtx, limit = 50) {
    const checks = (await this.#o.guardian.recentChecks(200, v.address))
      .filter((c) => sameAddress(c.vault, v.address))
      .slice(0, Math.min(200, Math.max(1, limit)));
    const reviews = new Map(
      (
        this.#db
          .prepare("SELECT check_id, status, note, updated_at FROM check_reviews WHERE vault_id = ?")
          .all(v.id) as ReviewRow[]
      ).map((r) => [r.check_id, r]),
    );
    return checks.map((c) => {
      const r = reviews.get(c.checkId.toLowerCase());
      return { ...c, review: r ? { status: r.status, note: r.note, updatedAt: r.updated_at } : null };
    });
  }

  async reviewCheck(v: VaultCtx, checkId: string, input: Record<string, unknown>) {
    const status = oneOf(input.status, ["reviewed", "false_positive", "escalated"] as const, "status");
    const note = text(input.note, 500, "Ghi chú");
    const check = await this.#o.guardian.check(checkId);
    if (!check || !sameAddress(check.vault, v.address)) throw notFound("lần kiểm tra này của két");
    // A LOW check cannot be a false positive: there was no alarm to dismiss.
    if (status === "false_positive" && check.risk === "LOW")
      throw new AccountError(409, "not_an_alarm", "Kiểm tra rủi ro THẤP không thể là báo động nhầm.");
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO check_reviews (vault_id, check_id, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (vault_id, check_id) DO UPDATE SET status = excluded.status, note = excluded.note,
           updated_at = excluded.updated_at`,
      )
      .run(v.id, checkId.toLowerCase(), status, note, now, now);
    this.#audit(v.userId, "check_reviewed", { vault: v.address, checkId, status });
    return { checkId: check.checkId, risk: check.risk, review: { status, note, updatedAt: now } };
  }

  deleteReview(v: VaultCtx, checkId: string) {
    const res = this.#db
      .prepare("DELETE FROM check_reviews WHERE vault_id = ? AND check_id = ?")
      .run(v.id, checkId.toLowerCase());
    if (res.changes !== 1) throw notFound("đánh giá");
  }
}
