// The vault a new owner creates in /bat-dau: checks on the draft, and the AgentVault.Config it becomes.
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  checkAgent,
  DEFAULT_DRAFT,
  limitIssues,
  limitNotes,
  recipientIssues,
  rulesInWords,
  vaultConfig,
  type SetupDraft,
} from "@/lib/setup";

const USDC = getAddress("0x5425890298aed601595a70ab815c96711a31bc65");
const OWNER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const SHOP = "0x3333333333333333333333333333333333333333";

const draft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  ...DEFAULT_DRAFT,
  agentAddress: AGENT,
  recipients: [{ name: "Cửa hàng", address: SHOP }],
  ...patch,
});

describe("setup draft", () => {
  it("refuses an agent wallet that is invalid, zero or the owner's own", () => {
    expect(checkAgent("", [OWNER]).ok).toBe(false);
    expect(checkAgent("0x123", [OWNER]).ok).toBe(false);
    expect(checkAgent(`0x${"0".repeat(40)}`, [OWNER]).ok).toBe(false);
    expect(checkAgent(OWNER.toUpperCase().replace("0X", "0x"), [OWNER])).toMatchObject({ ok: false });
    expect(checkAgent(AGENT, [OWNER])).toEqual({ ok: true, address: getAddress(AGENT) });
  });

  it("needs at least one named, valid, distinct recipient that is not the agent", () => {
    expect(recipientIssues([{ name: "", address: "" }], AGENT)).toHaveLength(1);
    expect(recipientIssues([{ name: "A", address: "0x12" }], AGENT)[0]?.field).toBe("address");
    expect(recipientIssues([{ name: "", address: SHOP }], AGENT)[0]?.field).toBe("name");
    expect(recipientIssues([{ name: "Agent", address: AGENT }], AGENT)[0]?.message).toMatch(/ví của agent/);
    expect(
      recipientIssues(
        [
          { name: "A", address: SHOP },
          { name: "B", address: SHOP.toUpperCase().replace("0X", "0x") },
        ],
        AGENT,
      )[0]?.message,
    ).toMatch(/đã có/);
    expect(recipientIssues(draft().recipients, AGENT)).toEqual([]);
  });

  it("flags limits that cannot work", () => {
    expect(limitIssues({ dailyCap: 0, maxPerTx: 0, budget: 0 }).map((i) => i.field)).toEqual(["dailyCap"]);
    expect(limitIssues({ dailyCap: 10, maxPerTx: -1, budget: 0 }).map((i) => i.field)).toEqual(["maxPerTx"]);
    expect(limitIssues({ dailyCap: 20, maxPerTx: 5, budget: 100 })).toEqual([]);
  });

  it("notes odd but valid limits without blocking", () => {
    // A total below the daily cap is the "spend this much, then wait for me" setup.
    expect(limitIssues({ dailyCap: 10, maxPerTx: 2, budget: 5 })).toEqual([]);
    expect(limitNotes({ dailyCap: 10, maxPerTx: 2, budget: 5 }).map((i) => i.field)).toEqual(["budget"]);
    expect(limitIssues({ dailyCap: 10, maxPerTx: 20, budget: 0 })).toEqual([]);
    expect(limitNotes({ dailyCap: 10, maxPerTx: 20, budget: 0 }).map((i) => i.field)).toEqual(["maxPerTx"]);
    expect(limitNotes({ dailyCap: 20, maxPerTx: 5, budget: 100 })).toEqual([]);
  });

  it("becomes a payments-only Config in USDC base units", () => {
    const c = vaultConfig(draft({ dailyCap: 20, maxPerTx: 2.5, budget: 100, maxRisk: 1 }), USDC);
    expect(c.maxAgentRisk).toBe(1);
    expect(c.tokens).toEqual([
      {
        token: USDC,
        dailyCap: 20_000_000n,
        maxApproval: 0n,
        verdictThreshold: 0n,
        maxPerTx: 2_500_000n,
        budget: 100_000_000n,
      },
    ]);
    expect(c.nativeDailyCap).toBe(0n);
    expect(c.targets).toEqual([]);
    expect(c.recipients).toEqual([getAddress(SHOP)]);
  });

  it("says the rules in words", () => {
    const words = rulesInWords(draft()).join(" ");
    expect(words).toContain("Chỉ trả tiền cho Cửa hàng.");
    expect(words).toContain("Tối đa 20 USDC mỗi ngày, 5 USDC mỗi giao dịch.");
    expect(words).toContain("Tổng cộng tối đa 100 USDC");
    expect(rulesInWords(draft({ recipients: [{ name: "", address: "" }] }))[0]).toMatch(/Chưa có người nhận/);
  });
});
