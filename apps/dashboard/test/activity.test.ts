import { describe, expect, it } from "vitest";
import type { Diff } from "@guardian402/shared";
import {
  buildActivity,
  itemFromAttempt,
  matchesFilter,
  moneyEffects,
  needsAttention,
  summarizeDiff,
} from "../src/lib/activity";
import type { ExecutedEvent } from "../src/lib/events";
import type { ActivityItem } from "../src/lib/activity";
import type { Attempt, CheckListRow } from "../src/lib/types";

const VAULT = "0x6a8ccc880238df1f4309d1b04edfbd6017a4cf3c";
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const WAVAX = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const ATTACKER = "0x000000000000000000000000000000000000a77A";
const names: Record<string, string> = { [ROUTER.toLowerCase()]: "Sàn swap thử nghiệm" };
const nameOf = (a: string) => names[a.toLowerCase()];
const meta = (t: string) =>
  t.toLowerCase() === USDC.toLowerCase()
    ? { symbol: "USDC", decimals: 6 }
    : { symbol: "mWAVAX", decimals: 18 };

const diff = (d: Partial<Diff>): Diff => ({
  tokenDeltas: [],
  nativeDelta: "0",
  approvals: [],
  transfers: [],
  ...d,
});
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const check = (n: number, over: Partial<CheckListRow> = {}): CheckListRow => ({
  checkId: hex(n),
  createdAt: 1_000 + n,
  endpoint: "cosign",
  vault: VAULT,
  risk: "LOW",
  score: 0,
  latencyMs: 300,
  demo: true,
  ruleIds: [],
  explanation: null,
  paymentTx: null,
  ...over,
});
const exec = (n: number, checkId: string, withVerdict = true): ExecutedEvent => ({
  txHash: `0x${"e".repeat(63)}${n}` as `0x${string}`,
  blockNumber: BigInt(n),
  timeMs: 5_000 + n,
  checkId: checkId as `0x${string}`,
  withVerdict,
  nonceUsed: 1n,
});
const attempt = (over: Partial<Attempt>): Attempt => ({
  at: "2026-11-12T00:00:00.000Z",
  scenario: "S2",
  name: "drain-to-attacker",
  network: "local",
  mode: "scripted-attack",
  vault: [],
  matched: true,
  ...over,
});

describe("summarizeDiff", () => {
  it("names a transfer by amount and recipient", () => {
    const d = diff({
      tokenDeltas: [{ token: USDC, symbol: "USDC", decimals: 6, delta: "-50000000" }],
      transfers: [{ token: USDC, from: VAULT, to: ATTACKER, amount: "50000000" }],
    });
    expect(summarizeDiff(d, VAULT, nameOf, meta)).toBe("Chuyển 50 USDC tới 0x0000…a77A");
  });

  it("names a swap by what leaves and what arrives", () => {
    const d = diff({
      tokenDeltas: [
        { token: USDC, symbol: "USDC", decimals: 6, delta: "-2000000" },
        { token: WAVAX, symbol: "mWAVAX", decimals: 18, delta: "79760000000000000" },
      ],
    });
    expect(summarizeDiff(d, VAULT, nameOf, meta)).toBe("Swap 2 USDC lấy 0,0797 mWAVAX");
  });

  it("calls an unlimited approval unlimited and uses the known name", () => {
    const d = diff({
      approvals: [{ token: USDC, spender: ROUTER, amount: (2n ** 256n - 1n).toString(), unlimited: true }],
    });
    expect(summarizeDiff(d, VAULT, nameOf, meta)).toBe(
      "Cấp quyền rút không giới hạn USDC cho Sàn swap thử nghiệm",
    );
  });

  it("says when nothing changes", () => {
    expect(summarizeDiff(diff({}), VAULT, nameOf, meta)).toBe("Không làm đổi số dư của két");
    expect(moneyEffects(diff({ nativeDelta: "-1" }))).toEqual([{ symbol: "AVAX", raw: -1n, decimals: 18 }]);
  });
});

describe("buildActivity", () => {
  it("joins checks with the vault's executions and the agent's attempts", () => {
    const items = buildActivity({
      checks: [
        check(1),
        check(2, { risk: "HIGH", endpoint: "cosign" }),
        check(3, { endpoint: "demo" }),
        check(4, { endpoint: "check" }),
        check(5),
      ],
      executions: [exec(1, hex(1)), exec(9, hex(0), false)],
      attempts: [
        attempt({
          guardian: { endpoint: "cosign", status: 200, risk: "HIGH", checkId: hex(2) },
          vault: [{ status: "reverted", revert: "RecipientNotAllowed", tx: "0xab" }],
        }),
        attempt({
          at: "2026-11-12T00:00:05.000Z",
          scenario: "S5",
          vault: [{ status: "reverted", revert: "VerdictExpired" }],
        }),
      ],
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(hex(1))?.outcome).toEqual({ kind: "executed", tx: exec(1, hex(1)).txHash });
    expect(byId.get(hex(2))?.outcome).toEqual({
      kind: "rejected",
      reason: "RecipientNotAllowed",
      tx: "0xab",
    });
    expect(byId.has(hex(3))).toBe(false); // a free trial check is not the vault's history
    expect(byId.get(hex(4))?.outcome.kind).toBe("check-only");
    expect(byId.get(hex(5))?.outcome.kind).toBe("not-seen");
    // An execution below the verdict threshold has no check: it is its own item.
    expect(byId.get(exec(9, hex(0), false).txHash)?.outcome.kind).toBe("executed");
    // An attempt whose check is not in the list is its own item too.
    expect(items.some((i) => i.attempt?.scenario === "S5" && i.outcome.kind === "rejected")).toBe(true);
    // Newest first, and the matched execution is not listed twice.
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort((a, b) => b - a));
    expect(items.filter((i) => i.execution?.txHash === exec(1, hex(1)).txHash)).toHaveLength(1);
  });

  it("keeps the outcome of an attempt made on another network, without its transaction link", () => {
    const items = buildActivity({
      checks: [check(1, { risk: "HIGH" })],
      executions: [],
      attempts: [
        attempt({
          network: "fuji",
          guardian: { endpoint: "cosign", status: 200, risk: "HIGH", checkId: hex(1) },
          vault: [{ status: "reverted", revert: "RiskTooHigh", tx: "0xab" }],
        }),
        attempt({
          network: "fuji",
          at: "2026-11-12T00:00:09.000Z",
          vault: [{ status: "reverted", revert: "Paused" }],
        }),
      ],
      network: "local",
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.outcome).toEqual({ kind: "rejected", reason: "RiskTooHigh", tx: undefined });
  });

  it("leaves free trial checks out: anyone can run one on any vault", () => {
    const items = buildActivity({
      checks: [check(1, { risk: "LOW" }), check(2, { risk: "HIGH", endpoint: "demo" })],
      executions: [],
      attempts: [],
    });
    expect(items.map((i) => i.check?.endpoint)).toEqual(["cosign"]);
  });

  it("never shows a verdict as an execution", () => {
    const [item] = buildActivity({ checks: [check(7, { risk: "LOW" })], executions: [], attempts: [] });
    expect(item?.outcome.kind).not.toBe("executed");
  });

  it("filters and flags what needs attention", () => {
    const high = buildActivity({ checks: [check(1, { risk: "HIGH" })], executions: [], attempts: [] })[0];
    const trial: ActivityItem = { id: "t", at: 0, risk: "HIGH", outcome: { kind: "trial" } };
    const rejected = itemFromAttempt(attempt({ vault: [{ status: "reverted", revert: "Paused" }] }));
    expect(high && matchesFilter(high, "high")).toBe(true);
    expect(high && matchesFilter(high, "executed")).toBe(false);
    expect(rejected.outcome.kind).toBe("rejected");
    expect(matchesFilter(rejected, "rejected")).toBe(true);
    expect(high && needsAttention(high)).toBe(true);
    expect(trial && needsAttention(trial)).toBe(false);
    expect(needsAttention(rejected)).toBe(true);
  });
});
