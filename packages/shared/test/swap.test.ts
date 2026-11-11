import { describe, expect, it } from "vitest";
import { DEMO_ORACLE_PRICE, minOutUsdcToWavax, SWAP_TOLERANCE_BPS } from "../src/swap.ts";

describe("minOutUsdcToWavax", () => {
  it("is the oracle quote minus 1% by default", () => {
    // 2 USDC at 25 USDC per mWAVAX = 0.08 mWAVAX; minus 1% = 0.0792 mWAVAX (18 decimals).
    expect(SWAP_TOLERANCE_BPS).toBe(100n);
    expect(minOutUsdcToWavax(2_000_000n, DEMO_ORACLE_PRICE)).toBe(79_200_000_000_000_000n);
    expect(minOutUsdcToWavax(2_000_000n, DEMO_ORACLE_PRICE, 0n)).toBe(80_000_000_000_000_000n);
  });

  it("gives 0 without a price or an amount", () => {
    expect(minOutUsdcToWavax(2_000_000n, 0n)).toBe(0n);
    expect(minOutUsdcToWavax(0n, DEMO_ORACLE_PRICE)).toBe(0n);
  });
});
