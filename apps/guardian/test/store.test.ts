// The store's address-book source and the per-vault check list (docs/THREAT_MODEL.md, D3 and D4).
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { CheckResponse } from "@guardian402/shared";
import { Store } from "../src/store.ts";

const VAULT: Address = "0x1111111111111111111111111111111111111111";
const OTHER_VAULT: Address = "0x2222222222222222222222222222222222222222";
const AGENT: Address = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const OWNER: Address = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const STRANGER: Address = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const PAYEE: Address = "0x3333333333333333333333333333333333333333";
const PLANTED: Address = "0x4444444444444444444444444444444444444444";

let n = 0;
function check(store: Store, endpoint: string, vault: Address, to: Address, risk = "LOW") {
  const checkId = `0x${(++n).toString(16).padStart(64, "0")}`;
  const res = {
    checkId,
    risk,
    score: 0,
    findings: [],
    diff: {
      tokenDeltas: [],
      nativeDelta: "0",
      approvals: [],
      transfers: [{ token: PAYEE, from: vault, to }],
    },
    explanation: { vi: "", en: "", source: "template" },
    simulation: { success: true, gasUsed: "0", forkBlock: "0" },
    latencyMs: 1,
    demoMode: endpoint === "demo",
  } as unknown as CheckResponse;
  store.insertCheck(endpoint, vault, "0x00", res, n);
  return checkId;
}
const pay = (store: Store, checkId: string, payer: Address | null) =>
  store.insertPayment({ payer, amount: "5000", txHash: "0x01", endpoint: "check", checkId });

describe("paidRecipients", () => {
  it("counts only LOW checks paid by the vault's agent or owner", () => {
    const store = new Store(":memory:");
    pay(store, check(store, "check", VAULT, PAYEE), AGENT.toLowerCase() as Address);
    const book = store.paidRecipients(VAULT, [AGENT, OWNER]);
    expect(book.map((a) => a.toLowerCase())).toEqual([PAYEE.toLowerCase()]);
  });

  it("ignores free demo checks, unpaid checks and checks paid by anyone else", () => {
    const store = new Store(":memory:");
    check(store, "demo", VAULT, PLANTED); // free endpoint, any caller
    check(store, "check", VAULT, PLANTED); // never settled
    pay(store, check(store, "check", VAULT, PLANTED), STRANGER); // 0.005 USDC from a stranger
    pay(store, check(store, "cosign", VAULT, PLANTED), null);
    pay(store, check(store, "demo", VAULT, PLANTED), AGENT); // a demo row never counts
    pay(store, check(store, "check", VAULT, PLANTED, "HIGH"), AGENT);
    pay(store, check(store, "check", OTHER_VAULT, PLANTED), AGENT); // another vault's history
    expect(store.paidRecipients(VAULT, [AGENT, OWNER])).toEqual([]);
    expect(store.paidRecipients(VAULT, [])).toEqual([]);
  });
});

describe("recentChecks", () => {
  it("lists one vault's checks, however many checks other vaults have", () => {
    const store = new Store(":memory:");
    const mine = check(store, "demo", VAULT, PAYEE, "HIGH");
    for (let i = 0; i < 250; i++) check(store, "demo", OTHER_VAULT, PAYEE);
    expect(store.recentChecks(200).some((c) => c.checkId === mine)).toBe(false); // pushed off the global list
    const own = store.recentChecks(200, { vault: VAULT.toUpperCase().replace("0X", "0x") as Address });
    expect(own.map((c) => c.checkId)).toEqual([mine]);
  });

  it("combines the vault filter with settledOnly", () => {
    const store = new Store(":memory:");
    const unpaid = check(store, "check", VAULT, PAYEE);
    const paid = check(store, "check", VAULT, PAYEE);
    pay(store, paid, AGENT);
    const ids = store.recentChecks(10, { vault: VAULT, settledOnly: true }).map((c) => c.checkId);
    expect(ids).toEqual([paid]);
    expect(ids).not.toContain(unpaid);
  });
});
