// Vault workspace business rules on an in-memory database, with a fake chain and a fake Guardian.
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it } from "vitest";
import { agentVaultAbi } from "@guardian402/shared";
import { AccountError, Accounts } from "../src/server/accounts";
import { openDb, type Db } from "../src/server/db";
import type { ChainPort, GuardianCheck, GuardianPort, TxLookup } from "../src/server/ports";
import { looksLike, Workspace } from "../src/server/workspace";

const CHAIN = 43113;
const HOST = "localhost:3000";
const VAULT = getAddress("0x3f6a5852788ff6a46d924c407976bb89487f7651");
const ROUTER = getAddress("0xe20967c615e442991d468ed7f797edcaea1771d9");
const USDC = getAddress("0x5425890298aed601595a70ab815c96711a31bc65");
const addr = () => privateKeyToAccount(generatePrivateKey()).address;
const checkId = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

let db: Db;
let now: number;
let accounts: Accounts;
let ws: Workspace;
let chain: {
  owner: Address;
  agent: Address;
  allow: Set<string>;
  cap: { dailyCap: bigint; remaining: bigint } | null;
  txs: Map<string, TxLookup>;
  down: boolean;
};
let guardian: { checks: GuardianCheck[]; down: boolean };
let ownerPk: Hex;
let userId: string;

const chainPort: ChainPort = {
  vaultOwner: async () => chain.owner,
  vaultAgent: async () => chain.agent,
  allowlisted: async (_v, a) => ({ recipient: chain.allow.has(a.toLowerCase()), target: false }),
  capUsage: async () => {
    if (chain.down) throw new Error("rpc down");
    return chain.cap;
  },
  transaction: async (h) => chain.txs.get(h.toLowerCase()) ?? { found: false },
  vaultPolicy: async () => {
    throw new Error("not used here");
  },
  execution: async () => ({ found: false }),
};
const guardianPort: GuardianPort = {
  recentChecks: async () => {
    if (guardian.down) throw new Error("guardian down");
    return [...guardian.checks].sort((a, b) => b.createdAt - a.createdAt);
  },
  check: async (id) => guardian.checks.find((c) => c.checkId === id) ?? null,
};

async function signInWallet(pk: Hex, current?: string) {
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
    currentUserId: current ?? null,
  });
}

const err = async (f: () => unknown) => {
  try {
    await f();
  } catch (e) {
    if (e instanceof AccountError) return `${e.status} ${e.code}`;
    throw e;
  }
  return "ok";
};

beforeEach(async () => {
  db = openDb(":memory:");
  now = Date.UTC(2026, 10, 10, 12);
  ownerPk = generatePrivateKey();
  chain = {
    owner: privateKeyToAccount(ownerPk).address,
    agent: zeroAddress,
    allow: new Set(),
    cap: null,
    txs: new Map(),
    down: false,
  };
  guardian = { checks: [], down: false };
  accounts = new Accounts(db, { chainId: CHAIN, now: () => now, readVaultOwner: async () => chain.owner });
  ws = new Workspace(db, {
    chain: chainPort,
    guardian: guardianPort,
    chainId: CHAIN,
    capToken: USDC,
    known: [{ name: "MockRouter", address: ROUTER }],
    now: () => now,
  });
  userId = (await signInWallet(ownerPk)).user.id;
  await accounts.linkVault(userId, { address: VAULT });
});

describe("access", () => {
  it("only the user who linked the vault reaches its workspace", async () => {
    const other = (await signInWallet(generatePrivateKey())).user.id;
    expect(await err(() => ws.vault(other, VAULT))).toBe("404 not_found");
    expect(await err(() => ws.vault(userId, "0x1234"))).toBe("400 bad_address");
    expect(ws.vault(userId, VAULT.toLowerCase()).address).toBe(VAULT);
  });

  it("a new on-chain owner takes the link over and the old workspace is purged", async () => {
    const v = ws.vault(userId, VAULT);
    ws.createContact(v, { name: "Kho bạc", address: addr() });
    ws.createAlertRule(v, { name: "Cao", kind: "risk", minRisk: "HIGH" });
    const newPk = generatePrivateKey();
    const other = (await signInWallet(newPk)).user.id;
    chain.owner = privateKeyToAccount(newPk).address;
    await accounts.linkVault(other, { address: VAULT });
    const v2 = ws.vault(other, VAULT);
    expect(await ws.listContacts(v2)).toEqual([]);
    expect(ws.listAlertRules(v2)).toEqual([]);
  });
});

describe("agents", () => {
  it("creates, lists with the on-chain flag, and protects the active agent", async () => {
    const v = ws.vault(userId, VAULT);
    const a = addr();
    const created = ws.createAgent(v, { name: "DCA bot", address: a, description: "Mua mWAVAX mỗi ngày" });
    expect(created).toMatchObject({
      name: "DCA bot",
      address: a,
      description: "Mua mWAVAX mỗi ngày",
      status: "active",
    });
    expect(created).not.toHaveProperty("strategy");
    expect(await err(() => ws.createAgent(v, { name: "dup", address: a }))).toBe("409 duplicate");
    expect(await err(() => ws.createAgent(v, { name: "me", address: chain.owner }))).toBe(
      "409 owner_as_agent",
    );
    expect(await err(() => ws.createAgent(v, { name: "", address: addr() }))).toBe("400 missing_field");
    chain.agent = a;
    expect((await ws.listAgents(v)).agents[0]?.isOnChainAgent).toBe(true);
    expect(await err(() => ws.deleteAgent(v, created.id))).toBe("409 agent_active_on_chain");
    expect(await err(() => ws.updateAgent(v, created.id, { address: addr() }))).toBe("400 immutable");
    expect(ws.updateAgent(v, created.id, { status: "paused" }).status).toBe("paused");
    chain.agent = zeroAddress;
    expect(await err(() => ws.deleteAgent(v, created.id))).toBe("ok");
  });
});

describe("contacts", () => {
  it("refuses lookalikes of trusted addresses unless confirmed, and reads the allowlist from the chain", async () => {
    const v = ws.vault(userId, VAULT);
    const lookalikeRouter = getAddress(`0x${ROUTER.slice(2, 6)}${"b".repeat(32)}${ROUTER.slice(-4)}`);
    expect(looksLike(lookalikeRouter, ROUTER)).toBe(true);
    // The DEMO lookalike of the Fuji router matches only 3+3 characters; the address book still catches it.
    expect(looksLike("0xE20b3196DcAf7663E8E834bA881a513cF761d1d9", ROUTER)).toBe(true);
    expect(looksLike(ROUTER, ROUTER)).toBe(false);
    expect(await err(() => ws.createContact(v, { name: "Router?", address: lookalikeRouter }))).toBe(
      "409 lookalike",
    );
    const treasury = addr();
    ws.createContact(v, { name: "Kho bạc", address: treasury, kind: "treasury" });
    const twin = getAddress(`0x${treasury.slice(2, 6)}${"c".repeat(32)}${treasury.slice(-4)}`);
    expect(await err(() => ws.createContact(v, { name: "Kho bạc 2", address: twin }))).toBe("409 lookalike");
    expect(
      await err(() => ws.createContact(v, { name: "Kho bạc 2", address: twin, confirmLookalike: true })),
    ).toBe("ok");
    expect(accounts.me(userId).events.map((e) => e.event)).toContain("contact_added_lookalike");
    chain.allow.add(treasury.toLowerCase());
    const list = await ws.listContacts(v);
    expect(list.find((c) => c.address === treasury)?.allowlisted.recipient).toBe(true);
    expect(await err(() => ws.createContact(v, { name: "x", address: treasury }))).toBe("409 duplicate");
    expect(await err(() => ws.createContact(v, { name: "self", address: VAULT }))).toBe("400 bad_address");
  });
});

describe("policy changes", () => {
  it("prepares the exact vault call for each kind, with warnings for weakening changes", () => {
    const v = ws.vault(userId, VAULT);
    const agent = addr();
    const cases: [Record<string, unknown>, string, unknown[]][] = [
      [{ kind: "pause" }, "pause", []],
      [{ kind: "unpause" }, "unpause", []],
      [{ kind: "revoke_agent" }, "setAgent", [zeroAddress]],
      [{ kind: "set_agent", params: { agent } }, "setAgent", [agent]],
      [
        { kind: "allow_recipient", params: { address: ROUTER, allowed: true } },
        "setAllowedRecipient",
        [ROUTER, true],
      ],
      [
        { kind: "allow_target", params: { address: ROUTER, allowed: false } },
        "setAllowedTarget",
        [ROUTER, false],
      ],
      [
        {
          kind: "token_policy",
          params: {
            token: USDC,
            tracked: true,
            dailyCap: "20000000",
            maxApproval: "10000000",
            verdictThreshold: "1000000",
          },
        },
        "setTokenPolicy",
        [USDC, true, 20_000_000n, 10_000_000n, 1_000_000n],
      ],
      [
        { kind: "native_policy", params: { dailyCap: "100", verdictThreshold: "10" } },
        "setNativePolicy",
        [100n, 10n],
      ],
      [{ kind: "max_agent_risk", params: { risk: 0 } }, "setMaxAgentRisk", [0]],
    ];
    for (const [input, fn, args] of cases) {
      const c = ws.createPolicyChange(v, input);
      expect(c).toMatchObject({ status: "draft", transaction: { to: VAULT, value: "0" } });
      const decoded = decodeFunctionData({ abi: agentVaultAbi, data: c.transaction.data });
      expect(decoded.functionName).toBe(fn);
      expect(decoded.args ?? []).toEqual(args);
    }
    expect(
      ws.createPolicyChange(v, {
        kind: "token_policy",
        params: { token: USDC, tracked: true, dailyCap: "1", maxApproval: "1", verdictThreshold: "5" },
      }).warnings[0],
    ).toMatch(/Ngưỡng/);
    expect(ws.createPolicyChange(v, { kind: "max_agent_risk", params: { risk: 2 } }).warnings).toHaveLength(
      1,
    );
    expect(
      ws.createPolicyChange(v, { kind: "set_agent", params: { agent: chain.owner } }).warnings[0],
    ).toMatch(/ví chủ/);
  });

  it("validates parameters", async () => {
    const v = ws.vault(userId, VAULT);
    expect(await err(() => ws.createPolicyChange(v, { kind: "withdraw" }))).toBe("400 bad_field");
    expect(
      await err(() => ws.createPolicyChange(v, { kind: "set_agent", params: { agent: zeroAddress } })),
    ).toBe("400 bad_address");
    expect(await err(() => ws.createPolicyChange(v, { kind: "set_agent", params: { agent: VAULT } }))).toBe(
      "400 bad_address",
    );
    expect(
      await err(() =>
        ws.createPolicyChange(v, {
          kind: "native_policy",
          params: { dailyCap: "-1", verdictThreshold: "0" },
        }),
      ),
    ).toBe("400 bad_amount");
    expect(await err(() => ws.createPolicyChange(v, { kind: "max_agent_risk", params: { risk: 3 } }))).toBe(
      "400 bad_amount",
    );
    expect(
      await err(() => ws.createPolicyChange(v, { kind: "allow_recipient", params: { address: ROUTER } })),
    ).toBe("400 bad_field");
  });

  it("verifies the owner's transaction on chain: vault, calldata, sender, then pending → confirmed", async () => {
    const v = ws.vault(userId, VAULT);
    const c = ws.createPolicyChange(v, { kind: "pause" });
    const h = (n: number) => `0x${n.toString(16).padStart(64, "a")}` as Hex;
    const tx = (over: Partial<Extract<TxLookup, { found: true }>>): TxLookup => ({
      found: true,
      from: chain.owner,
      to: VAULT,
      input: c.transaction.data,
      status: "success",
      ...over,
    });
    expect(await err(() => ws.submitPolicyChange(v, c.id, { txHash: "0x12" }))).toBe("400 bad_tx");
    expect(await err(() => ws.submitPolicyChange(v, c.id, { txHash: h(1) }))).toBe("422 tx_not_found");
    chain.txs.set(h(2), tx({ to: ROUTER }));
    expect(await err(() => ws.submitPolicyChange(v, c.id, { txHash: h(2) }))).toBe("422 tx_wrong_vault");
    chain.txs.set(h(3), tx({ input: "0xdeadbeef" }));
    expect(await err(() => ws.submitPolicyChange(v, c.id, { txHash: h(3) }))).toBe("422 tx_wrong_call");
    chain.txs.set(h(4), tx({ from: addr() }));
    expect(await err(() => ws.submitPolicyChange(v, c.id, { txHash: h(4) }))).toBe("422 tx_wrong_sender");
    chain.txs.set(h(5), tx({ status: "pending" }));
    expect((await ws.submitPolicyChange(v, c.id, { txHash: h(5) })).status).toBe("submitted");
    expect(await err(() => ws.updatePolicyChange(v, c.id, { note: "x" }))).toBe("409 not_draft");
    expect(await err(() => ws.cancelPolicyChange(v, c.id))).toBe("409 not_draft");
    chain.txs.set(h(5), tx({ status: "success" }));
    const done = await ws.refreshPolicyChange(v, c.id);
    expect(done).toMatchObject({ status: "confirmed", txHash: h(5), confirmedAt: now });
    // The same transaction cannot confirm a second change.
    const c2 = ws.createPolicyChange(v, { kind: "pause" });
    expect(await err(() => ws.submitPolicyChange(v, c2.id, { txHash: h(5) }))).toBe("409 tx_reused");
    chain.txs.set(h(6), { ...tx({}), input: c2.transaction.data, status: "reverted" } as TxLookup);
    expect((await ws.submitPolicyChange(v, c2.id, { txHash: h(6) })).status).toBe("failed");
  });

  it("drafts can be edited (calldata rebuilt) and cancelled", () => {
    const v = ws.vault(userId, VAULT);
    const c = ws.createPolicyChange(v, { kind: "set_agent", params: { agent: addr() } });
    const next = addr();
    const edited = ws.updatePolicyChange(v, c.id, { params: { agent: next }, note: "agent mới" });
    expect(decodeFunctionData({ abi: agentVaultAbi, data: edited.transaction.data }).args).toEqual([next]);
    expect(edited.note).toBe("agent mới");
    expect(ws.cancelPolicyChange(v, c.id).status).toBe("cancelled");
  });
});

describe("alerts", () => {
  const check = (n: number, over: Partial<GuardianCheck> = {}): GuardianCheck => ({
    checkId: checkId(n),
    createdAt: now,
    endpoint: "/v1/cosign",
    vault: VAULT.toLowerCase(),
    risk: "HIGH",
    score: 100,
    ruleIds: ["ADDRESS_POISONING"],
    explanation: null,
    paymentTx: null,
    ...over,
  });

  it("fires risk and rule alerts once per check, only for this vault and only after the rule exists", async () => {
    const v = ws.vault(userId, VAULT);
    guardian.checks.push(check(1, { createdAt: now - 1000 })); // before the rules
    const high = ws.createAlertRule(v, { name: "Rủi ro cao", kind: "risk", minRisk: "HIGH" });
    ws.createAlertRule(v, { name: "Địa chỉ nhái", kind: "rule", ruleId: "ADDRESS_POISONING" });
    guardian.checks.push(
      check(2),
      check(3, { risk: "MEDIUM", score: 40, ruleIds: ["ABNORMAL_SLIPPAGE"] }),
      check(4, { vault: addr().toLowerCase() }), // another vault
    );
    expect(await ws.syncAlerts(v)).toEqual({ created: 2, guardian: true, chain: true });
    expect(await ws.syncAlerts(v)).toMatchObject({ created: 0 }); // idempotent
    const list = ws.listNotifications(v);
    expect(list.unread).toBe(2);
    expect(list.notifications.map((n) => n.checkId)).toEqual([checkId(2), checkId(2)]);
    ws.updateAlertRule(v, high.id, { minRisk: "MEDIUM" });
    expect((await ws.syncAlerts(v)).created).toBe(1); // check 3 now matches
    expect(ws.markRead(v, { all: true }).updated).toBe(3);
    expect(ws.listNotifications(v, true).notifications).toEqual([]);
  });

  it("cap usage fires once per day, and outages are reported instead of thrown", async () => {
    const v = ws.vault(userId, VAULT);
    ws.createAlertRule(v, { name: "80% hạn mức", kind: "cap_usage", capPercent: 80 });
    chain.cap = { dailyCap: 20_000_000n, remaining: 10_000_000n }; // 50 %
    expect((await ws.syncAlerts(v)).created).toBe(0);
    chain.cap = { dailyCap: 20_000_000n, remaining: 2_000_000n }; // 90 %
    expect((await ws.syncAlerts(v)).created).toBe(1);
    expect((await ws.syncAlerts(v)).created).toBe(0);
    now += 86_400_000;
    expect((await ws.syncAlerts(v)).created).toBe(1);
    chain.down = true;
    ws.createAlertRule(v, { name: "Cao", kind: "risk", minRisk: "HIGH" });
    guardian.down = true;
    expect(await ws.syncAlerts(v)).toEqual({ created: 0, guardian: false, chain: false });
  });

  it("validates rules", async () => {
    const v = ws.vault(userId, VAULT);
    expect(await err(() => ws.createAlertRule(v, { name: "x", kind: "risk", minRisk: "LOW" }))).toBe(
      "400 bad_field",
    );
    expect(await err(() => ws.createAlertRule(v, { name: "x", kind: "rule", ruleId: "drop table" }))).toBe(
      "400 bad_field",
    );
    expect(await err(() => ws.createAlertRule(v, { name: "x", kind: "cap_usage", capPercent: 0 }))).toBe(
      "400 bad_amount",
    );
    const r = ws.createAlertRule(v, { name: "x", kind: "cap_usage", capPercent: 50 });
    expect(await err(() => ws.updateAlertRule(v, r.id, { kind: "risk" }))).toBe("400 immutable");
    expect(ws.updateAlertRule(v, r.id, { enabled: false }).enabled).toBe(false);
  });
});

describe("check reviews", () => {
  it("reviews only this vault's checks, and a LOW check cannot be a false positive", async () => {
    const v = ws.vault(userId, VAULT);
    guardian.checks.push(
      {
        checkId: checkId(10),
        createdAt: now,
        endpoint: "/v1/check",
        vault: VAULT.toLowerCase(),
        risk: "HIGH",
        score: 100,
        ruleIds: ["DRAIN_PATTERN"],
        explanation: null,
        paymentTx: null,
      },
      {
        checkId: checkId(11),
        createdAt: now,
        endpoint: "/v1/check",
        vault: VAULT.toLowerCase(),
        risk: "LOW",
        score: 0,
        ruleIds: [],
        explanation: null,
        paymentTx: null,
      },
      {
        checkId: checkId(12),
        createdAt: now,
        endpoint: "/v1/check",
        vault: addr().toLowerCase(),
        risk: "HIGH",
        score: 100,
        ruleIds: [],
        explanation: null,
        paymentTx: null,
      },
    );
    expect(await err(() => ws.reviewCheck(v, checkId(12), { status: "reviewed" }))).toBe("404 not_found");
    expect(await err(() => ws.reviewCheck(v, checkId(11), { status: "false_positive" }))).toBe(
      "409 not_an_alarm",
    );
    await ws.reviewCheck(v, checkId(10), { status: "escalated", note: "báo nhóm" });
    await ws.reviewCheck(v, checkId(10), { status: "reviewed" }); // upsert
    const list = await ws.listChecks(v);
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.checkId === checkId(10))?.review).toMatchObject({
      status: "reviewed",
      note: null,
    });
    ws.deleteReview(v, checkId(10));
    expect(await err(() => ws.deleteReview(v, checkId(10)))).toBe("404 not_found");
  });
});
