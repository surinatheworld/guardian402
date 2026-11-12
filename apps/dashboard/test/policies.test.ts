// Policies (spec, summary, "Thử policy", plan), assignments and agent API keys, on an in-memory database with a
// fake chain whose AgentVault state the tests set directly.
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it } from "vitest";
import { deployment } from "../src/lib/config";
import { naming, templateSpec } from "../src/lib/policy-catalog";
import {
  canonicalSpec,
  evaluate,
  exampleScenarios,
  parseSpec,
  planChanges,
  summarize,
  type OnChainPolicy,
  type PolicySpec,
} from "../src/lib/policy-spec";
import { AccountError, Accounts } from "../src/server/accounts";
import { AgentApi } from "../src/server/agent-api";
import { openDb, type Db } from "../src/server/db";
import { Policies } from "../src/server/policies";
import type { ChainPort, ExecutionLookup, GuardianCheck, GuardianPort } from "../src/server/ports";
import { Workspace } from "../src/server/workspace";

const CHAIN = 43113;
const HOST = "localhost:3000";
const VAULT = getAddress(deployment.vault);
const USDC = getAddress(deployment.usdc);
const WAVAX = getAddress(deployment.mWAVAX);
const ROUTER = getAddress(deployment.router);
const GUARDIAN = getAddress("0x00000000000000000000000000000000000000aa");
const addr = () => privateKeyToAccount(generatePrivateKey()).address;
const usdc = (n: number) => String(Math.round(n * 1_000_000));
const n = naming([]);

const err = async (f: () => unknown) => {
  try {
    await f();
  } catch (e) {
    if (e instanceof AccountError) return `${e.status} ${e.code}`;
    throw e;
  }
  return "ok";
};

/** "Thanh toán nhà cung cấp" from the product proposal. */
const supplierA = getAddress("0x1111111111111111111111111111111111111111");
const treasury = getAddress("0x2222222222222222222222222222222222222222");
const payments: PolicySpec = {
  tokens: [{ token: USDC, dailyCap: usdc(100), maxApproval: "0", verdictThreshold: usdc(10) }],
  native: { dailyCap: "0", verdictThreshold: "0" },
  recipients: [supplierA, treasury],
  spenders: [],
  contracts: [],
  maxRisk: 0,
};

const emptyChain = (): OnChainPolicy => ({
  agent: zeroAddress,
  guardian: GUARDIAN,
  paused: false,
  maxAgentRisk: 0,
  tokens: [],
  nativeDailyCap: 0n,
  nativeVerdictThreshold: 0n,
  nativeSpentToday: 0n,
  targets: [],
  recipients: [],
});

/** The vault state after `s` was applied for `agent` (what the owner's signed changes produce). */
const applied = (s: PolicySpec, agent: Address): OnChainPolicy => ({
  ...emptyChain(),
  agent,
  maxAgentRisk: s.maxRisk,
  tokens: s.tokens.map((t) => ({
    token: t.token,
    dailyCap: BigInt(t.dailyCap),
    maxApproval: BigInt(t.maxApproval),
    verdictThreshold: BigInt(t.verdictThreshold),
    spentToday: 0n,
  })),
  nativeDailyCap: BigInt(s.native.dailyCap),
  nativeVerdictThreshold: BigInt(s.native.verdictThreshold),
  targets: s.contracts.map((c) => ({ target: c.address, selectors: c.selectors })),
  recipients: [...new Set([...s.recipients, ...s.spenders])],
});

describe("policy spec", () => {
  it("validates and normalises input", () => {
    const s = parseSpec(
      {
        tokens: [{ token: USDC.toLowerCase(), dailyCap: "100", verdictThreshold: 10 }],
        recipients: [supplierA.toLowerCase(), supplierA],
        contracts: [{ address: ROUTER, selectors: ["0xABCDEF01", "0xabcdef01"] }],
      },
      VAULT,
    );
    expect(s.tokens[0]).toEqual({ token: USDC, dailyCap: "100", maxApproval: "0", verdictThreshold: "10" });
    expect(s.recipients).toEqual([supplierA]);
    expect(s.contracts[0]?.selectors).toEqual(["0xabcdef01"]);
    expect(s.native).toEqual({ dailyCap: "0", verdictThreshold: "0" });
    expect(() => parseSpec({ recipients: [VAULT] }, VAULT)).toThrow(/chính két/);
    expect(() => parseSpec({ tokens: [{ token: USDC, dailyCap: "-1", verdictThreshold: "0" }] })).toThrow(
      /số nguyên/,
    );
    expect(() => parseSpec({ contracts: [{ address: ROUTER, selectors: ["0x12"] }] })).toThrow(/selector/);
    expect(() =>
      parseSpec({
        tokens: [{ token: USDC, dailyCap: "1", verdictThreshold: "0" }],
        contracts: [{ address: USDC, selectors: ["0xa9059cbb"] }],
      }),
    ).toThrow(/chuyển hoặc cấp quyền rút/);
    expect(canonicalSpec({ ...payments, recipients: [treasury, supplierA] })).toBe(canonicalSpec(payments));
  });

  it("summarises the policy in words", () => {
    const text = summarize(payments, naming([{ name: "Nhà cung cấp A", address: supplierA }])).join(" ");
    expect(text).toContain("Được chi tối đa 100 USDC mỗi ngày");
    expect(text).toContain("vượt 10 USDC cần Guardian kiểm tra và duyệt");
    expect(text).toContain("Nhà cung cấp A");
    expect(text).toContain("Không được cấp quyền rút");
    const swap = summarize(templateSpec("swap", []), n);
    expect(swap).toContain("Chỉ được gửi tiền cho Sàn swap thử nghiệm.");
    expect(swap.some((line) => line.startsWith("Được cấp quyền chi tiêu cho Sàn swap thử nghiệm"))).toBe(
      true,
    );
  });

  it("answers the proposal's example transactions from the configuration", () => {
    const t = (amount: number, to: Address, spent = 0) =>
      evaluate(
        payments,
        { kind: "transfer", asset: USDC, to, amount: BigInt(usdc(amount)), spentToday: BigInt(usdc(spent)) },
        n,
      ).result;
    expect(t(5, supplierA)).toBe("allowed");
    expect(t(20, supplierA)).toBe("needs_verdict");
    expect(t(5, addr())).toBe("blocked");
    expect(t(30, supplierA, 80)).toBe("blocked");
    expect(t(20, supplierA, 80)).toBe("needs_verdict");
    expect(
      evaluate(payments, { kind: "approve", token: USDC, spender: supplierA, amount: 1n }, n).result,
    ).toBe("blocked");
    expect(evaluate(payments, { kind: "approve", token: USDC, spender: addr(), amount: 0n }, n).result).toBe(
      "allowed",
    );
    expect(
      evaluate(payments, { kind: "transfer", asset: "native", to: supplierA, amount: 1n, spentToday: 0n }, n)
        .result,
    ).toBe("blocked");
    const swap = templateSpec("swap", []);
    const sel = swap.contracts[0]?.selectors[0] as Hex;
    const call = evaluate(swap, { kind: "call", contract: ROUTER, selector: sel }, n);
    expect(call.result).toBe("allowed");
    // AgentVault review R1/R2: a call is free of a verdict only while it moves nothing out of the vault.
    expect(call.checks.map(({ label, status }) => [label, status])).toEqual([
      ["Contract", "allowed"],
      ["Thao tác", "allowed"],
      ["Chữ ký", "allowed"],
    ]);
    expect(call.checks.at(-1)?.detail).toContain("luôn cần Guardian duyệt");
    // AgentVault review R3: paying an address that is also an allowed contract needs a verdict at any amount,
    // while a plain recipient is still paid without one up to the threshold.
    const pay = (to: Address, amount: bigint) =>
      evaluate(swap, { kind: "transfer", asset: USDC, to, amount, spentToday: 0n }, n);
    expect(pay(ROUTER, 1n).result).toBe("needs_verdict");
    expect(pay(ROUTER, 1n).checks.at(-1)?.detail).toContain("ứng dụng được phép dùng");
    expect(pay(ROUTER, 0n).result).toBe("allowed");
    const swapAndPay = { ...swap, recipients: [supplierA] };
    expect(
      evaluate(swapAndPay, { kind: "transfer", asset: USDC, to: supplierA, amount: 1n, spentToday: 0n }, n)
        .result,
    ).toBe("allowed");
    expect(evaluate(swap, { kind: "call", contract: ROUTER, selector: "0x12345678" }, n).result).toBe(
      "blocked",
    );
    expect(
      evaluate(swap, { kind: "approve", token: USDC, spender: ROUTER, amount: BigInt(usdc(10)) }, n).result,
    ).toBe("needs_verdict");
    expect(
      evaluate(swap, { kind: "approve", token: USDC, spender: ROUTER, amount: BigInt(usdc(11)) }, n).result,
    ).toBe("blocked");
    expect(exampleScenarios(payments).map((e) => evaluate(payments, e.scenario, n).result)).toEqual([
      "allowed",
      "needs_verdict",
      "blocked",
      "blocked",
    ]);
    const transfer = { kind: "transfer" as const, asset: USDC, to: supplierA, amount: BigInt(usdc(20)) };
    const checks = (spentToday: number) =>
      evaluate(payments, { ...transfer, spentToday: BigInt(usdc(spentToday)) }, n).checks.map(
        ({ label, status }) => [label, status],
      );
    expect(checks(0)).toEqual([
      ["Người nhận", "allowed"],
      ["Hạn mức ngày", "allowed"],
      ["Chữ ký", "needs_verdict"],
    ]);
    expect(checks(90)).toEqual([
      ["Người nhận", "allowed"],
      ["Hạn mức ngày", "blocked"],
    ]);
    expect(exampleScenarios(swap).map(({ scenario }) => scenario.kind)).toEqual(
      expect.arrayContaining(["approve", "call"]),
    );
  });

  it("plans owner transactions: removals first, the agent last, foreign tokens locked", () => {
    const agent = addr();
    const stale = addr();
    const chain: OnChainPolicy = {
      ...emptyChain(),
      agent: addr(),
      maxAgentRisk: 1,
      tokens: [
        { token: WAVAX, dailyCap: 5n, maxApproval: 0n, verdictThreshold: 1n, spentToday: 0n },
        {
          token: USDC,
          dailyCap: 20_000_000n,
          maxApproval: 10_000_000n,
          verdictThreshold: 1_000_000n,
          spentToday: 0n,
        },
      ],
      targets: [{ target: ROUTER, selectors: ["0x12345678"] }],
      recipients: [stale, treasury],
    };
    const plan = planChanges(payments, chain, agent, n);
    const kinds = plan.changes.map((c) => `${c.kind}:${JSON.stringify(c.params)}`);
    expect(plan.changes.at(-1)).toMatchObject({ kind: "set_agent", params: { agent } });
    expect(
      kinds.indexOf(`allow_recipient:${JSON.stringify({ address: stale, allowed: false })}`),
    ).toBeLessThan(kinds.indexOf(`allow_recipient:${JSON.stringify({ address: supplierA, allowed: true })}`));
    expect(plan.changes).toContainEqual(
      expect.objectContaining({ kind: "allow_target", params: { address: ROUTER, allowed: false } }),
    );
    expect(plan.changes).toContainEqual(
      expect.objectContaining({
        kind: "token_policy",
        params: { token: WAVAX, tracked: true, dailyCap: "0", maxApproval: "0", verdictThreshold: "0" },
      }),
    );
    expect(plan.changes).toContainEqual(
      expect.objectContaining({ kind: "max_agent_risk", params: { risk: 0 } }),
    );
    expect(plan.notes.join(" ")).toContain("mất quyền thực thi");
    expect(planChanges(payments, applied(payments, agent), agent, n).changes).toEqual([]);
    expect(
      planChanges(payments, { ...applied(payments, agent), guardian: zeroAddress }, agent, n).blockers,
    ).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ services

let db: Db;
let now: number;
let accounts: Accounts;
let ws: Workspace;
let policies: Policies;
let api: AgentApi;
let chain: { owner: Address; state: OnChainPolicy; down: boolean; executions: Map<string, ExecutionLookup> };
let guardianChecks: GuardianCheck[];
let userId: string;

const chainPort: ChainPort = {
  vaultOwner: async () => chain.owner,
  vaultAgent: async () => chain.state.agent,
  allowlisted: async () => ({ recipient: false, target: false }),
  capUsage: async () => null,
  transaction: async () => ({ found: false }),
  vaultPolicy: async () => {
    if (chain.down) throw new Error("rpc down");
    return chain.state;
  },
  execution: async (_v, h) => chain.executions.get(h.toLowerCase()) ?? { found: false },
};
const guardianPort: GuardianPort = {
  recentChecks: async () => guardianChecks,
  check: async (id) => guardianChecks.find((c) => c.checkId === id) ?? null,
};

async function signInWallet(pk: Hex) {
  const account = privateKeyToAccount(pk);
  const message = createSiweMessage({
    domain: HOST,
    address: account.address,
    uri: `http://${HOST}`,
    version: "1",
    chainId: CHAIN,
    nonce: accounts.issueNonce(),
    issuedAt: new Date(now),
  });
  return accounts.signInWithEthereum({
    message,
    signature: await account.signMessage({ message }),
    host: HOST,
    origin: `http://${HOST}`,
    currentUserId: null,
  });
}

beforeEach(async () => {
  db = openDb(":memory:");
  now = Date.UTC(2026, 10, 10, 12);
  const ownerPk = generatePrivateKey();
  chain = {
    owner: privateKeyToAccount(ownerPk).address,
    state: emptyChain(),
    down: false,
    executions: new Map(),
  };
  guardianChecks = [];
  accounts = new Accounts(db, { chainId: CHAIN, now: () => now, readVaultOwner: async () => chain.owner });
  ws = new Workspace(db, {
    chain: chainPort,
    guardian: guardianPort,
    chainId: CHAIN,
    capToken: USDC,
    known: [{ name: "MockRouter", address: ROUTER }],
    now: () => now,
  });
  policies = new Policies(db, { chain: chainPort, workspace: ws, now: () => now });
  api = new AgentApi(db, { chain: chainPort, guardian: guardianPort, policies, now: () => now });
  userId = (await signInWallet(ownerPk)).user.id;
  await accounts.linkVault(userId, { address: VAULT });
});

describe("policy library", () => {
  it("versions rules, keeps names unique per user and refuses other users", async () => {
    const p = policies.create(userId, {
      name: "Thanh toán nhà cung cấp",
      template: "payments",
      spec: payments,
    });
    expect(p).toMatchObject({ latest: { version: 1 }, versionCount: 1, template: "payments" });
    expect(
      await err(() => policies.create(userId, { name: "thanh toán nhà cung cấp", spec: payments })),
    ).toBe("409 duplicate");
    expect(await err(() => policies.create(userId, { name: "x", spec: { tokens: "no" } }))).toBe(
      "400 bad_spec",
    );
    // Same rules in another order: no new version.
    expect(
      policies.update(userId, p.id, { spec: { ...payments, recipients: [treasury, supplierA] } }).newVersion,
    ).toBe(null);
    const v2 = policies.update(userId, p.id, {
      spec: { ...payments, tokens: [{ ...payments.tokens[0], dailyCap: usdc(50) }] },
      note: "Giảm ngân sách",
    });
    expect(v2.newVersion).toBe(2);
    expect(v2.policy.versions.map((v) => v.version)).toEqual([2, 1]);
    const other = (await signInWallet(generatePrivateKey())).user.id;
    expect(await err(() => policies.get(other, p.id))).toBe("404 not_found");
    expect(policies.list(other)).toEqual([]);
  });
});

describe("assignments", () => {
  it("assigns, plans, drafts the owner transactions and turns active once the vault matches", async () => {
    const v = ws.vault(userId, VAULT);
    const agentAddr = addr();
    const agent = ws.createAgent(v, { name: "Thanh toán", address: agentAddr });
    const p = policies.create(userId, { name: "Thanh toán nhà cung cấp", spec: payments });
    const a = policies.assign(v, { agentId: agent.id, policyId: p.id });
    expect(policies.list(userId)[0]?.assignments).toEqual([
      expect.objectContaining({ agentId: agent.id, version: 1, vault: VAULT }),
    ]);

    const before = await policies.overview(v);
    expect(before.agents[0]?.enforcement).toMatchObject({ state: "pending", drafts: 0 });

    const res = await policies.apply(v, a.id);
    expect(res.changes.map((c) => c.kind)).toEqual([
      "token_policy",
      "allow_recipient",
      "allow_recipient",
      "set_agent",
    ]);
    expect(res.changes.every((c) => c.assignmentId === a.id && c.status === "draft")).toBe(true);
    // Applying again replaces the unsent drafts instead of piling them up.
    await policies.apply(v, a.id);
    expect(ws.listPolicyChanges(v).filter((c) => c.status === "draft")).toHaveLength(4);

    chain.state = applied(payments, agentAddr);
    const after = await policies.overview(v);
    expect(after.agents[0]?.enforcement?.state).toBe("active");
    expect(after.onChain?.budgets[0]).toMatchObject({ symbol: "USDC", dailyCap: usdc(100) });
    expect(await err(() => policies.archive(userId, p.id))).toBe("409 in_use");

    // A new version is not in force until the agent is moved to it and the owner signs again.
    policies.update(userId, p.id, { spec: { ...payments, maxRisk: 1 } });
    expect((await policies.overview(v)).agents[0]?.assignment?.policy.latestVersion).toBe(2);
    const moved = policies.assign(v, { agentId: agent.id, policyId: p.id });
    expect(moved.version.version).toBe(2);
    expect(ws.listPolicyChanges(v).filter((c) => c.status === "draft")).toHaveLength(0);
    expect((await policies.plan(v, moved.id)).enforcement).toMatchObject({ state: "pending" });

    chain.down = true;
    expect((await policies.overview(v)).agents[0]?.enforcement?.state).toBe("unknown");

    policies.unassign(v, agent.id);
    expect(await err(() => policies.archive(userId, p.id))).toBe("ok");
    expect(await err(() => policies.assign(v, { agentId: agent.id, policyId: p.id }))).toBe("409 archived");
  });
});

describe("agent API", () => {
  it("issues keys shown once, authenticates them, and scopes everything to the agent's vault", async () => {
    const v = ws.vault(userId, VAULT);
    const agentAddr = addr();
    const agent = ws.createAgent(v, { name: "Bot", address: agentAddr });
    const { key, apiKey } = api.createKey(v, agent.id, { name: "prod" });
    expect(key).toMatch(/^g402_[A-Za-z0-9_-]{32}$/);
    expect(key.startsWith(apiKey.prefix)).toBe(true);
    const stored = db.prepare("SELECT * FROM api_keys").all() as Record<string, unknown>[];
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(api.listKeys(v, agent.id)).toEqual([expect.objectContaining({ name: "prod", revokedAt: null })]);

    expect(await err(() => api.authenticate(null))).toBe("401 bad_api_key");
    expect(await err(() => api.authenticate(`Bearer ${key}x`))).toBe("401 bad_api_key");
    const p = api.authenticate(`Bearer ${key}`);
    expect(p.agent.address).toBe(agentAddr);
    expect(p.vault.address).toBe(VAULT);

    const calls = [{ target: USDC, value: "0", data: "0x" }];
    // The vault is the rule book: a check needs no off-chain policy; co-signing needs the on-chain agent.
    expect((await api.me(p)).isOnChainAgent).toBe(false);
    expect((await api.me(p)).guideline[0]).toMatch(/not the agent of the vault/);
    expect(await err(() => api.prepareCheck(p, "check", { calls }))).toBe("ok");
    expect(await api.prepareCheck(p, "check", { calls })).toMatchObject({ chainId: CHAIN, vault: VAULT });
    expect(await err(() => api.prepareCheck(p, "check", { calls, vault: addr() }))).toBe("403 wrong_vault");
    expect(await err(() => api.prepareCheck(p, "check", { calls: [] }))).toBe("400 invalid_request");
    expect(await err(() => api.prepareCheck(p, "cosign", { calls }))).toBe("409 not_vault_agent");

    chain.state = {
      ...applied(payments, agentAddr),
      limits: [
        {
          token: USDC,
          maxPerTx: BigInt(usdc(5)),
          budget: BigInt(usdc(50)),
          spentSinceReset: BigInt(usdc(20)),
        },
      ],
    };
    expect(await err(() => api.prepareCheck(p, "cosign", { calls }))).toBe("ok");
    const me = await api.me(p);
    expect(me).toMatchObject({ isOnChainAgent: true, vaultPaused: false });
    expect(me.rules?.tokens[0]).toMatchObject({
      token: USDC,
      dailyCap: usdc(100),
      spentToday: "0",
      maxPerTx: usdc(5),
      budgetLeft: usdc(30),
    });
    const text = me.guideline.join(" ");
    expect(text).toContain("at most 5 USDC per transaction");
    expect(text).toContain("30 USDC left of a total budget of 50 USDC");

    chain.down = true;
    expect(await err(() => api.prepareCheck(p, "cosign", { calls }))).toBe("503 chain_unavailable");
    chain.down = false;

    // Pausing the agent in the registry stops the API (not the vault: that needs revoke_agent).
    // Each request authenticates again, so it sees the new status.
    ws.updateAgent(v, agent.id, { status: "paused" });
    const paused = api.authenticate(`Bearer ${key}`);
    expect(await err(() => api.prepareCheck(paused, "cosign", { calls }))).toBe("403 agent_not_active");

    const checkId = `0x${"ab".repeat(32)}`;
    guardianChecks = [
      {
        checkId,
        createdAt: now,
        endpoint: "cosign",
        vault: addr(),
        risk: "LOW",
        score: 0,
        ruleIds: [],
        explanation: null,
        paymentTx: null,
      },
    ];
    expect(await err(() => api.check(p, checkId))).toBe("404 not_found");
    guardianChecks = guardianChecks.map((c) => ({ ...c, vault: VAULT }));
    expect((await api.check(p, checkId)).checkId).toBe(checkId);

    const hash = `0x${"cd".repeat(32)}`;
    chain.executions.set(hash, {
      found: true,
      from: agentAddr,
      to: VAULT,
      status: "success",
      blockNumber: "1",
      executed: { checkId: checkId as Hex, withVerdict: true, nonce: "0" },
    });
    expect(await api.execution(p, hash)).toMatchObject({ state: "executed", toVault: true, fromAgent: true });
    expect(await api.execution(p, `0x${"ee".repeat(32)}`)).toMatchObject({ state: "not_found" });

    api.revokeKey(v, agent.id, apiKey.id);
    expect(await err(() => api.authenticate(`Bearer ${key}`))).toBe("401 bad_api_key");
    const other = (await signInWallet(generatePrivateKey())).user.id;
    expect(await err(() => api.listKeys(ws.vault(other, VAULT), agent.id))).toBe("404 not_found");
  });
});
