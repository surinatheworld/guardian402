// A named, reusable policy: what an agent may do with the vault's assets, in the terms the AgentVault enforces
// (docs/SPEC.md §4.3). Pure functions shared by the browser (builder, summary, "Thử policy") and the server
// (validation, the plan of owner transactions that makes a vault match a policy). No I/O here.
//
// Enforcement point: everything in a PolicySpec maps to AgentVault state, so once applied on chain the vault
// enforces it even if the agent skips the Guardian API. Two limits of the current contract are kept visible:
// - one agent per vault, with vault-level daily counters (spent = balance decrease per token per UTC day);
// - recipients and approval spenders share one on-chain list (`allowedRecipient`).
import { formatUnits, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";

export const POLICY_LIMITS = {
  tokens: 8,
  recipients: 50,
  spenders: 20,
  contracts: 20,
  selectors: 10,
} as const;
const MAX_UINT256 = 2n ** 256n - 1n;

export type RiskCode = 0 | 1 | 2;

/** Amounts are base-unit integers as decimal strings (JSON-safe). */
export type TokenRule = { token: Address; dailyCap: string; maxApproval: string; verdictThreshold: string };
export type ContractRule = { address: Address; selectors: Hex[] };
export type PolicySpec = {
  /** ERC-20 assets the agent may spend; any other tracked token is locked (cap 0). */
  tokens: TokenRule[];
  /** Native AVAX; dailyCap "0" = the agent cannot spend AVAX. */
  native: { dailyCap: string; verdictThreshold: string };
  /** May receive transfers. */
  recipients: Address[];
  /** May be granted an approval (up to the token's maxApproval, always with a Guardian verdict). */
  spenders: Address[];
  /** Contracts the agent may call, with the allowed functions (4-byte selectors). */
  contracts: ContractRule[];
  /** Highest Guardian risk the vault accepts in a verdict. */
  maxRisk: RiskCode;
};

export const EMPTY_SPEC: PolicySpec = {
  tokens: [],
  native: { dailyCap: "0", verdictThreshold: "0" },
  recipients: [],
  spenders: [],
  contracts: [],
  maxRisk: 0,
};

export class SpecError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "SpecError";
  }
}

// ------------------------------------------------------------------ parsing

const uint = (v: unknown, field: string): string => {
  const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
  if (typeof s !== "string" || !/^\d{1,78}$/.test(s))
    throw new SpecError(field, `${field}: phải là số nguyên ≥ 0 (đơn vị gốc).`);
  const n = BigInt(s);
  if (n > MAX_UINT256) throw new SpecError(field, `${field}: quá lớn.`);
  return n.toString();
};

const addr = (v: unknown, field: string, vault?: Address): Address => {
  if (typeof v !== "string" || !isAddress(v, { strict: false }))
    throw new SpecError(field, `${field}: không phải địa chỉ hợp lệ.`);
  const a = getAddress(v);
  if (a === zeroAddress) throw new SpecError(field, `${field}: không dùng địa chỉ 0x0.`);
  if (vault && a === getAddress(vault)) throw new SpecError(field, `${field}: không thể là chính vault.`);
  return a;
};

const list = (v: unknown, field: string, max: number): unknown[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new SpecError(field, `${field}: phải là danh sách.`);
  if (v.length > max) throw new SpecError(field, `${field}: tối đa ${max} mục.`);
  return v;
};

const uniqueAddresses = (v: unknown, field: string, max: number, vault?: Address): Address[] => {
  const out: Address[] = [];
  for (const [i, x] of list(v, field, max).entries()) {
    const a = addr(x, `${field}[${i}]`, vault);
    if (!out.includes(a)) out.push(a);
  }
  return out;
};

const selector = (v: unknown, field: string): Hex => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(v))
    throw new SpecError(field, `${field}: phải là selector 4 byte (0x + 8 ký tự hex).`);
  return v.toLowerCase() as Hex;
};

/** Validates untrusted input into a PolicySpec (addresses checksummed, duplicates removed). */
export function parseSpec(raw: unknown, vault?: Address): PolicySpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new SpecError("spec", "Cấu hình policy không hợp lệ.");
  const r = raw as Record<string, unknown>;
  const tokens: TokenRule[] = [];
  for (const [i, x] of list(r.tokens, "tokens", POLICY_LIMITS.tokens).entries()) {
    const t = (x ?? {}) as Record<string, unknown>;
    const token = addr(t.token, `tokens[${i}].token`, vault);
    if (tokens.some((y) => y.token === token))
      throw new SpecError("tokens", "Mỗi tài sản chỉ khai báo một lần.");
    tokens.push({
      token,
      dailyCap: uint(t.dailyCap, `tokens[${i}].dailyCap`),
      maxApproval: uint(t.maxApproval ?? "0", `tokens[${i}].maxApproval`),
      verdictThreshold: uint(t.verdictThreshold, `tokens[${i}].verdictThreshold`),
    });
  }
  const n = (r.native ?? {}) as Record<string, unknown>;
  const contracts: ContractRule[] = [];
  for (const [i, x] of list(r.contracts, "contracts", POLICY_LIMITS.contracts).entries()) {
    const c = (x ?? {}) as Record<string, unknown>;
    const address = addr(c.address, `contracts[${i}].address`, vault);
    if (contracts.some((y) => y.address === address))
      throw new SpecError("contracts", "Mỗi contract chỉ khai báo một lần.");
    if (tokens.some((t) => t.token === address))
      throw new SpecError(
        "contracts",
        "Token đã khai báo ở phần tài sản: vault chỉ cho agent gọi transfer/approve trên token đó.",
      );
    const selectors = [
      ...new Set(
        list(c.selectors, `contracts[${i}].selectors`, POLICY_LIMITS.selectors).map((s, j) =>
          selector(s, `contracts[${i}].selectors[${j}]`),
        ),
      ),
    ];
    if (!selectors.length)
      throw new SpecError("contracts", "Mỗi contract cần ít nhất một thao tác được phép.");
    contracts.push({ address, selectors });
  }
  const risk = r.maxRisk ?? 0;
  if (risk !== 0 && risk !== 1 && risk !== 2) throw new SpecError("maxRisk", "maxRisk phải là 0, 1 hoặc 2.");
  return {
    tokens,
    native: {
      dailyCap: uint(n.dailyCap ?? "0", "native.dailyCap"),
      verdictThreshold: uint(n.verdictThreshold ?? "0", "native.verdictThreshold"),
    },
    recipients: uniqueAddresses(r.recipients, "recipients", POLICY_LIMITS.recipients, vault),
    spenders: uniqueAddresses(r.spenders, "spenders", POLICY_LIMITS.spenders, vault),
    contracts,
    maxRisk: risk,
  };
}

/** Order-independent form, for "did the spec change?" (a new version is only made when it did). */
export function canonicalSpec(s: PolicySpec): string {
  const sort = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  return JSON.stringify({
    tokens: sort(s.tokens, (t) => t.token.toLowerCase()),
    native: s.native,
    recipients: sort(s.recipients, (a) => a.toLowerCase()),
    spenders: sort(s.spenders, (a) => a.toLowerCase()),
    contracts: sort(s.contracts, (c) => c.address.toLowerCase()).map((c) => ({
      address: c.address,
      selectors: [...c.selectors].sort(),
    })),
    maxRisk: s.maxRisk,
  });
}

// ------------------------------------------------------------------ words

export type AssetMeta = { symbol: string; decimals: number };
export type Naming = {
  /** Symbol and decimals of an ERC-20 (native AVAX is fixed). */
  asset: (token: Address) => AssetMeta;
  /** A human name for an address (contact, known contract), or undefined. */
  name: (address: Address) => string | undefined;
  /** A human name for a function selector of a contract, or undefined. */
  fn?: (contract: Address, selector: Hex) => string | undefined;
};

export const NATIVE_META: AssetMeta = { symbol: "AVAX", decimals: 18 };
export const RISK_WORD: Record<RiskCode, string> = { 0: "THẤP", 1: "TRUNG BÌNH", 2: "CAO" };

/** "12.5 USDC" without trailing zeros. */
export const amountText = (raw: string | bigint, m: AssetMeta) =>
  `${formatUnits(BigInt(raw), m.decimals)} ${m.symbol}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const who = (a: Address, n: Naming) => n.name(a) ?? short(a);
const people = (xs: Address[], n: Naming) =>
  xs.length <= 3 ? xs.map((a) => who(a, n)).join(", ") : `${xs.length} địa chỉ`;
const recipientsUnion = (s: PolicySpec) => [...new Set([...s.recipients, ...s.spenders])];

/** The policy in plain sentences, in the order an owner reads it. */
export function summarize(s: PolicySpec, n: Naming): string[] {
  const out: string[] = [];
  const spendable = s.tokens.filter((t) => BigInt(t.dailyCap) > 0n);
  const native = BigInt(s.native.dailyCap) > 0n;
  if (!spendable.length && !native) out.push("Agent chưa được chi tài sản nào: mọi khoản chi đều bị chặn.");
  for (const t of spendable) {
    const m = n.asset(t.token);
    out.push(
      `Được chi tối đa ${amountText(t.dailyCap, m)} mỗi ngày (UTC)` +
        (BigInt(t.verdictThreshold) < BigInt(t.dailyCap)
          ? `; khoản chi vượt ${amountText(t.verdictThreshold, m)} cần Guardian kiểm tra và ký verdict.`
          : "; không khoản chi nào cần verdict vì ngưỡng không nhỏ hơn hạn mức."),
    );
  }
  if (native)
    out.push(
      `Được chi tối đa ${amountText(s.native.dailyCap, NATIVE_META)} mỗi ngày; vượt ${amountText(s.native.verdictThreshold, NATIVE_META)} một lần cần verdict.`,
    );
  return [...out, ...summarizePermissions(s, n)];
}

/** Permission text reused by the review screen, which displays budgets separately. */
export function summarizePermissions(s: PolicySpec, n: Naming): string[] {
  const out: string[] = [];
  const allowedRecipients = recipientsUnion(s);
  out.push(
    allowedRecipients.length
      ? `Chỉ được gửi tiền cho ${allowedRecipients.length === 1 ? "" : `${allowedRecipients.length} người nhận: `}${people(allowedRecipients, n)}.`
      : "Không được gửi tiền cho ai.",
  );
  const approvable = s.tokens.filter((t) => BigInt(t.maxApproval) > 0n);
  if (allowedRecipients.length && approvable.length)
    out.push(
      `Được cấp quyền chi tiêu cho ${people(allowedRecipients, n)}, tối đa ${approvable.map((t) => amountText(t.maxApproval, n.asset(t.token))).join(", ")}, luôn cần verdict và tự thu hồi sau mỗi giao dịch.`,
    );
  else out.push("Không được cấp quyền chi tiêu (approval) cho ai.");
  if (s.contracts.length)
    out.push(
      `Được gọi ${s.contracts
        .map((c) => {
          const fns = c.selectors.map((x) => n.fn?.(c.address, x) ?? x);
          return `${who(c.address, n)} (${fns.join(", ")})`;
        })
        .join("; ")}.`,
    );
  else out.push("Không được gọi contract nào khác.");
  out.push(
    s.maxRisk === 0
      ? "Chỉ chấp nhận verdict rủi ro THẤP."
      : `Chấp nhận verdict rủi ro đến ${RISK_WORD[s.maxRisk]}.`,
  );
  return out;
}

/** Things the owner should know before saving or applying. */
export function specWarnings(s: PolicySpec, n: Naming): string[] {
  const w: string[] = [];
  for (const t of s.tokens) {
    const m = n.asset(t.token);
    if (BigInt(t.dailyCap) > 0n && BigInt(t.verdictThreshold) >= BigInt(t.dailyCap))
      w.push(
        `${m.symbol}: ngưỡng cần verdict không nhỏ hơn hạn mức, nên mọi khoản chi hợp lệ đều không cần Guardian ký.`,
      );
    if (BigInt(t.maxApproval) > 0n && !s.spenders.length)
      w.push(`${m.symbol}: có hạn mức cấp quyền nhưng chưa chọn bên nhận quyền nào.`);
  }
  if (BigInt(s.native.dailyCap) > 0n && BigInt(s.native.verdictThreshold) >= BigInt(s.native.dailyCap))
    w.push("AVAX: ngưỡng cần verdict không nhỏ hơn hạn mức.");
  const both = s.spenders.filter((a) => !s.recipients.includes(a));
  if (both.length)
    w.push(
      `Trên vault hiện tại, bên nhận quyền dùng chung danh sách với người nhận: ${people(both, n)} cũng nhận được chuyển khoản trực tiếp.`,
    );
  if (s.maxRisk > 0)
    w.push(`Agent có thể chạy giao dịch Guardian chấm rủi ro ${RISK_WORD[s.maxRisk]} nếu có verdict.`);
  if (s.contracts.length)
    w.push(
      "Gọi contract: số dư thực giảm sau giao dịch vẫn bị tính vào hạn mức và ngưỡng verdict của từng tài sản.",
    );
  return w;
}

// ------------------------------------------------------------------ "Thử policy"

export type Scenario =
  | { kind: "transfer"; asset: Address | "native"; to: Address; amount: bigint; spentToday: bigint }
  | { kind: "approve"; token: Address; spender: Address; amount: bigint }
  | { kind: "call"; contract: Address; selector: Hex };
type CheckStatus = "allowed" | "needs_verdict" | "blocked";
export type Outcome = {
  result: CheckStatus;
  checks: { label: string; status: CheckStatus; detail: string }[];
};

/**
 * What the vault would decide, from the configuration alone (no simulation): the order of the checks in
 * AgentVault.executeBatch — static policy (target, selector, recipient, approval), then daily cap, then the
 * verdict threshold. A batch with several calls, or a call whose real outflow differs, needs a simulation.
 */
export function evaluate(s: PolicySpec, sc: Scenario, n: Naming): Outcome {
  const allowedRecipients = recipientsUnion(s);
  const has = (xs: Address[], a: Address) => xs.some((x) => x.toLowerCase() === a.toLowerCase());
  const checks: Outcome["checks"] = [];
  const finish = (label: string, status: CheckStatus, detail: string): Outcome => ({
    result: status,
    checks: [...checks, { label, status, detail }],
  });
  if (sc.kind === "call") {
    const c = s.contracts.find((x) => x.address.toLowerCase() === sc.contract.toLowerCase());
    if (!c) return finish("Contract", "blocked", `${who(sc.contract, n)} ngoài danh sách.`);
    checks.push({ label: "Contract", status: "allowed", detail: who(c.address, n) });
    const fn = n.fn?.(c.address, sc.selector) ?? sc.selector;
    if (!c.selectors.includes(sc.selector.toLowerCase() as Hex))
      return finish("Thao tác", "blocked", `${fn} chưa được phép.`);
    return finish("Thao tác", "allowed", fn);
  }
  if (sc.kind === "approve") {
    const t = s.tokens.find((x) => x.token.toLowerCase() === sc.token.toLowerCase());
    const m = n.asset(sc.token);
    if (!t) return finish("Tài sản", "blocked", `${m.symbol} chưa được bật.`);
    if (sc.amount === 0n) return finish("Thu hồi quyền", "allowed", "Đưa approval về 0.");
    if (!has(allowedRecipients, sc.spender))
      return finish("Bên nhận quyền", "blocked", `${who(sc.spender, n)} ngoài danh sách.`);
    checks.push({ label: "Bên nhận quyền", status: "allowed", detail: who(sc.spender, n) });
    const limit = `Tối đa ${amountText(t.maxApproval, m)}.`;
    if (sc.amount > BigInt(t.maxApproval)) return finish("Mức cấp quyền", "blocked", limit);
    checks.push({ label: "Mức cấp quyền", status: "allowed", detail: limit });
    return finish(
      "Chữ ký",
      "needs_verdict",
      `Approval khác 0 cần Guardian ký, rủi ro tối đa ${RISK_WORD[s.maxRisk]}.`,
    );
  }
  const native = sc.asset === "native";
  const m = native ? NATIVE_META : n.asset(sc.asset as Address);
  const rule = native
    ? s.native
    : s.tokens.find((x) => x.token.toLowerCase() === String(sc.asset).toLowerCase());
  if (!rule) return finish("Tài sản", "blocked", `${m.symbol} chưa được bật.`);
  // A plain transfer (token transfer, or AVAX with no calldata) needs an allowlisted recipient.
  if (!has(allowedRecipients, sc.to))
    return finish("Người nhận", "blocked", `${who(sc.to, n)} ngoài danh sách.`);
  checks.push({ label: "Người nhận", status: "allowed", detail: who(sc.to, n) });
  const cap = BigInt(rule.dailyCap);
  const total = sc.spentToday + sc.amount;
  const used = `${amountText(total, m)} / ${amountText(cap, m)}`;
  if (total > cap) return finish("Hạn mức ngày", "blocked", `${used}. Vượt ${amountText(total - cap, m)}.`);
  checks.push({ label: "Hạn mức ngày", status: "allowed", detail: used });
  const threshold = amountText(rule.verdictThreshold, m);
  if (sc.amount > BigInt(rule.verdictThreshold))
    return finish("Chữ ký", "needs_verdict", `Vượt ${threshold}. Rủi ro tối đa ${RISK_WORD[s.maxRisk]}.`);
  return finish("Chữ ký", "allowed", `Khoản chuyển không vượt ${threshold}.`);
}

/** A few telling cases for the first spendable asset, like the table in the policy proposal. */
export function exampleScenarios(s: PolicySpec): { label: string; scenario: Scenario }[] {
  const to = recipientsUnion(s)[0];
  const contract = s.contracts.find((c) => c.selectors.length > 0);
  const selector = contract?.selectors[0];
  const approval = s.tokens.find((t) => BigInt(t.maxApproval) > 0n);
  const out: ReturnType<typeof exampleScenarios> = [];
  const token = s.tokens.find((t) => BigInt(t.dailyCap) > 0n);
  const rule = token ?? (BigInt(s.native.dailyCap) > 0n ? s.native : undefined);
  if (rule && to) {
    const asset = token?.token ?? "native";
    const cap = BigInt(rule.dailyCap);
    const threshold = BigInt(rule.verdictThreshold);
    const small = (threshold < cap ? threshold : cap) / 2n || 1n;
    out.push({
      label: "Khoản chuyển nhỏ",
      scenario: { kind: "transfer", asset, to, amount: small, spentToday: 0n },
    });
    if (threshold > 0n && threshold < cap) {
      const big = threshold * 2n <= cap ? threshold * 2n : cap;
      out.push({
        label: "Khoản chuyển lớn",
        scenario: { kind: "transfer", asset, to, amount: big, spentToday: 0n },
      });
    }
    const stranger = "0x000000000000000000000000000000000000dEaD";
    if (!recipientsUnion(s).some((a) => a.toLowerCase() === stranger.toLowerCase()))
      out.push({
        label: "Địa chỉ lạ",
        scenario: { kind: "transfer", asset, to: stranger, amount: small, spentToday: 0n },
      });
    const spent = (cap * 8n) / 10n;
    const over = cap - spent + 1n;
    if (over <= MAX_UINT256)
      out.push({
        label: "Vượt hạn mức",
        scenario: { kind: "transfer", asset, to, amount: over, spentToday: spent },
      });
  }
  if (approval && to)
    out.push({
      label: "Cấp approval",
      scenario: {
        kind: "approve",
        token: approval.token,
        spender: s.spenders[0] ?? to,
        amount: BigInt(approval.maxApproval),
      },
    });
  if (contract && selector)
    out.push({
      label: "Gọi contract",
      scenario: { kind: "call", contract: contract.address, selector },
    });
  return out;
}

// ------------------------------------------------------------------ applying to a vault

/** AgentVault.getPolicy(), in the fields a plan needs. */
export type OnChainPolicy = {
  agent: Address;
  guardian: Address;
  paused: boolean;
  maxAgentRisk: number;
  tokens: {
    token: Address;
    dailyCap: bigint;
    maxApproval: bigint;
    verdictThreshold: bigint;
    spentToday: bigint;
  }[];
  nativeDailyCap: bigint;
  nativeVerdictThreshold: bigint;
  nativeSpentToday: bigint;
  targets: { target: Address; selectors: Hex[] }[];
  recipients: Address[];
};

export type PlannedKind =
  | "set_agent"
  | "allow_recipient"
  | "allow_target"
  | "allow_selector"
  | "token_policy"
  | "native_policy"
  | "max_agent_risk";
export type PlannedChange = { kind: PlannedKind; params: Record<string, unknown>; reason: string };
export type Plan = { changes: PlannedChange[]; blockers: string[]; notes: string[] };

/**
 * The owner transactions that make the vault enforce `s` for `agent`, in a safe order: first everything that
 * takes permissions away, then the new limits and grants, and the agent itself last, so the agent never runs
 * under a mix of the old permissions and the new agent key.
 */
export function planChanges(s: PolicySpec, c: OnChainPolicy, agent: Address, n: Naming): Plan {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const inList = (xs: string[], a: string) => xs.some((x) => eq(x, a));
  const revoke: PlannedChange[] = [];
  const limits: PlannedChange[] = [];
  const grant: PlannedChange[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];

  // Recipients (one on-chain list for recipients and spenders).
  const wanted = recipientsUnion(s);
  for (const a of c.recipients)
    if (!inList(wanted, a))
      revoke.push({
        kind: "allow_recipient",
        params: { address: a, allowed: false },
        reason: `Gỡ người nhận ${who(a, n)}`,
      });
  for (const a of wanted)
    if (!inList(c.recipients, a))
      grant.push({
        kind: "allow_recipient",
        params: { address: a, allowed: true },
        reason: `Thêm người nhận ${who(a, n)}`,
      });

  // Contracts and their functions.
  for (const t of c.targets) {
    const want = s.contracts.find((x) => eq(x.address, t.target));
    for (const sel of t.selectors)
      if (!want || !want.selectors.includes(sel.toLowerCase() as Hex))
        revoke.push({
          kind: "allow_selector",
          params: { target: t.target, selector: sel.toLowerCase(), allowed: false },
          reason: `Gỡ thao tác ${n.fn?.(t.target, sel) ?? sel} trên ${who(t.target, n)}`,
        });
    if (!want)
      revoke.push({
        kind: "allow_target",
        params: { address: t.target, allowed: false },
        reason: `Gỡ contract ${who(t.target, n)}`,
      });
  }
  for (const want of s.contracts) {
    const have = c.targets.find((t) => eq(t.target, want.address));
    if (!have)
      grant.push({
        kind: "allow_target",
        params: { address: want.address, allowed: true },
        reason: `Cho phép gọi ${who(want.address, n)}`,
      });
    for (const sel of want.selectors)
      if (!have || !have.selectors.some((x) => eq(x, sel)))
        grant.push({
          kind: "allow_selector",
          params: { target: want.address, selector: sel, allowed: true },
          reason: `Cho phép ${n.fn?.(want.address, sel) ?? sel} trên ${who(want.address, n)}`,
        });
  }

  // Assets: declared tokens get their limits; any other tracked token is locked at 0 (not untracked, which
  // would lift its cap entirely).
  for (const t of c.tokens) {
    if (s.tokens.some((x) => eq(x.token, t.token))) continue;
    if (t.dailyCap === 0n && t.maxApproval === 0n && t.verdictThreshold === 0n) continue;
    revoke.push({
      kind: "token_policy",
      params: { token: t.token, tracked: true, dailyCap: "0", maxApproval: "0", verdictThreshold: "0" },
      reason: `Khoá ${n.asset(t.token).symbol}: không có trong policy nên hạn mức về 0`,
    });
  }
  for (const t of s.tokens) {
    const have = c.tokens.find((x) => eq(x.token, t.token));
    if (
      have &&
      have.dailyCap === BigInt(t.dailyCap) &&
      have.maxApproval === BigInt(t.maxApproval) &&
      have.verdictThreshold === BigInt(t.verdictThreshold)
    )
      continue;
    const m = n.asset(t.token);
    const lowers = have && BigInt(t.dailyCap) <= have.dailyCap && BigInt(t.maxApproval) <= have.maxApproval;
    (lowers ? revoke : limits).push({
      kind: "token_policy",
      params: { token: t.token, tracked: true, ...pick(t) },
      reason: `${m.symbol}: ${amountText(t.dailyCap, m)}/ngày, cấp quyền tối đa ${amountText(t.maxApproval, m)}, verdict từ ${amountText(t.verdictThreshold, m)}`,
    });
  }
  const tracked = new Set([
    ...c.tokens.map((t) => t.token.toLowerCase()),
    ...s.tokens.map((t) => t.token.toLowerCase()),
  ]);
  if (tracked.size > POLICY_LIMITS.tokens)
    blockers.push(
      `Vault theo dõi tối đa ${POLICY_LIMITS.tokens} token; policy và vault cộng lại vượt mức này.`,
    );
  if (
    c.nativeDailyCap !== BigInt(s.native.dailyCap) ||
    c.nativeVerdictThreshold !== BigInt(s.native.verdictThreshold)
  )
    (BigInt(s.native.dailyCap) <= c.nativeDailyCap ? revoke : limits).push({
      kind: "native_policy",
      params: { ...s.native },
      reason: `AVAX: ${amountText(s.native.dailyCap, NATIVE_META)}/ngày, verdict từ ${amountText(s.native.verdictThreshold, NATIVE_META)}`,
    });
  if (c.maxAgentRisk !== s.maxRisk)
    (s.maxRisk < c.maxAgentRisk ? revoke : limits).push({
      kind: "max_agent_risk",
      params: { risk: s.maxRisk },
      reason: `Rủi ro tối đa chấp nhận: ${RISK_WORD[s.maxRisk]}`,
    });

  const changes = [...revoke, ...limits, ...grant];
  if (!eq(c.agent, agent)) {
    changes.push({
      kind: "set_agent",
      params: { agent },
      reason: `Đặt ${who(agent, n)} làm agent của vault`,
    });
    if (c.agent !== zeroAddress)
      notes.push(`Vault chỉ có một agent: agent hiện tại (${who(c.agent, n)}) sẽ mất quyền thực thi.`);
  }
  if (c.guardian === zeroAddress)
    blockers.push("Vault chưa có Guardian: không giao dịch nào cần verdict chạy được.");
  if (c.paused)
    notes.push("Vault đang tạm dừng: policy có hiệu lực nhưng agent chưa chạy được cho tới khi mở lại.");
  notes.push("Đổi policy không xoá khoản đã chi hôm nay: bộ đếm theo ngày UTC của vault giữ nguyên.");
  return { changes, blockers, notes };
}

const pick = (t: TokenRule) => ({
  dailyCap: t.dailyCap,
  maxApproval: t.maxApproval,
  verdictThreshold: t.verdictThreshold,
});
