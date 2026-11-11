// Slippage protection for swaps through the DEMO MockRouter (docs/SPEC.md §8, UNPROTECTED_SWAP; §10, safe mode).
// The Guardian simulates a swap on a fork, but the vault executes it later on Fuji: without a minimum output
// (`minOut`), a pool that moves in between (or a sandwich) costs the vault whatever it moved. A well-behaved
// agent sets `minOut` from the reference price minus a small tolerance.

/** Tolerance a well-behaved agent leaves below the reference output: 1%. */
export const SWAP_TOLERANCE_BPS = 100n;

/** The DEMO MockOracle price, 25 USDC (6 decimals) per mWAVAX (SPEC §16), for callers that cannot read it. */
export const DEMO_ORACLE_PRICE = 25_000_000n;

/**
 * `minOut` for a USDC (6 decimals) → mWAVAX (18 decimals) swap of `amountIn` at `price` (USDC per mWAVAX, 6
 * decimals), minus `toleranceBps`. A price of 0 gives 0, which the Guardian then reports as unprotected.
 */
export function minOutUsdcToWavax(
  amountIn: bigint,
  price: bigint,
  toleranceBps = SWAP_TOLERANCE_BPS,
): bigint {
  if (price <= 0n || amountIn <= 0n) return 0n;
  const expected = (amountIn * 10n ** 18n) / price;
  return (expected * (10_000n - toleranceBps)) / 10_000n;
}
