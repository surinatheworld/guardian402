import { describe, expect, it } from "vitest";
import { retryOnFreshFork } from "../src/sim/simulator.ts";

const reverted = { success: false };
const STALE = 10_000;

describe("retryOnFreshFork", () => {
  // Fuji, 2026-11-13: a payment one minute after the owner's deposit reverted with "transfer amount exceeds
  // balance" on a fork taken 52 blocks before the deposit.
  it("retries a revert on a fork older than the threshold", () => {
    expect(retryOnFreshFork(reverted, true, 60_000, STALE)).toBe(true);
  });

  it("keeps a revert on a fresh fork: it is the real answer", () => {
    expect(retryOnFreshFork(reverted, true, 2_000, STALE)).toBe(false);
  });

  it("never retries a success, a timeout or an error", () => {
    expect(retryOnFreshFork({ success: true }, true, 60_000, STALE)).toBe(false);
    expect(retryOnFreshFork({ success: false, unavailable: "timed out" }, true, 60_000, STALE)).toBe(false);
  });

  it("needs an upstream to reset from (local fork)", () => {
    expect(retryOnFreshFork(reverted, false, 60_000, STALE)).toBe(false);
  });
});
