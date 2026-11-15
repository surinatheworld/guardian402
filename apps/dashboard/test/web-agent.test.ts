import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { USDC_FUJI } from "@guardian402/shared";
import { tryAmounts } from "../src/components/web-agent-try";
import { agentAddressOf, isAgentKey, toAgentKey, usdcTransfer } from "../src/lib/web-agent";

const U = 1_000_000n;

describe("web agent", () => {
  it("picks a payment the rules allow, and one over the per-payment cap", () => {
    expect(
      tryAmounts({ balance: 10n * U, dailyLeft: 20n * U, maxPerTx: 5n * U, budgetLeft: 100n * U }),
    ).toEqual({
      ok: 1n * U,
      blocked: { kind: "over-cap", amount: 6n * U },
    });
    // The vault cannot cover the over-cap payment (it would fail on the balance, not on a rule): a stranger.
    expect(
      tryAmounts({ balance: 4n * U, dailyLeft: 20n * U, maxPerTx: 5n * U, budgetLeft: null }).blocked,
    ).toEqual({ kind: "stranger", amount: 1n * U });
    // Small caps: half the per-payment cap; no per-payment cap: a payment to a stranger.
    expect(tryAmounts({ balance: 10n * U, dailyLeft: 3n * U, maxPerTx: U, budgetLeft: null }).ok).toBe(
      U / 2n,
    );
    expect(
      tryAmounts({ balance: 10n * U, dailyLeft: 3n * U, maxPerTx: 0n, budgetLeft: null }).blocked.kind,
    ).toBe("stranger");
    // An empty vault or a used-up budget leaves nothing to try.
    expect(tryAmounts({ balance: 0n, dailyLeft: 20n * U, maxPerTx: 5n * U, budgetLeft: null }).ok).toBe(0n);
    expect(tryAmounts({ balance: 10n * U, dailyLeft: 20n * U, maxPerTx: 5n * U, budgetLeft: 0n }).ok).toBe(
      0n,
    );
  });

  it("tries a payment just above the verdict threshold, so the Guardian is part of the try", () => {
    const base = { balance: 10n * U, dailyLeft: 20n * U, maxPerTx: 5n * U, budgetLeft: 100n * U };
    expect(tryAmounts({ ...base, freeBelow: U }).ok).toBe((3n * U) / 2n);
    // The caps win over the preference: then the payment may go out without the Guardian.
    expect(tryAmounts({ ...base, maxPerTx: 2n * U, freeBelow: 3n * U }).ok).toBe(U);
    expect(tryAmounts({ ...base, freeBelow: 0n }).ok).toBe(U);
  });

  it("knows an agent key and its address without sending it anywhere", () => {
    const key = `0x${"11".repeat(32)}`;
    expect(isAgentKey(key)).toBe(true);
    expect(isAgentKey("0x1234")).toBe(false);
    // MetaMask exports the key without 0x; surrounding spaces from a paste are ignored.
    expect(isAgentKey(` ${key.slice(2)} `)).toBe(true);
    expect(agentAddressOf(key.slice(2))).toBe(agentAddressOf(key));
    expect(toAgentKey(key.slice(2))).toBe(key);
    expect(agentAddressOf(key)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(agentAddressOf("nope")).toBeNull();
  });

  it("turns a payment into one USDC transfer from the vault", () => {
    const to = "0x64281A1b566EB95Ac50c42282Cc257DBD518fB50";
    const [call] = usdcTransfer(to, "1.5");
    expect(call?.target).toBe(USDC_FUJI.address);
    expect(call && decodeFunctionData({ abi: erc20Abi, data: call.data }).args).toEqual([to, 1_500_000n]);
  });
});
