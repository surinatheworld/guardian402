/**
 * A lookalike of a trusted address, the pattern of address poisoning, in either shape:
 * - the same first and last 3 hex characters, different address. Wallets show about 4+4 characters, and an
 *   attacker mines whatever is cheapest (the DEMO lookalike matches 3+3), so the address book is stricter than the
 *   Guardian's production rule (4+4);
 * - nearly the same address throughout: at most 4 hex characters differ (a typo-style twin, e.g. only the last
 *   character changed), the Guardian's `maxDiff`.
 * A true coincidence is about 1 in 16^6 and can be confirmed explicitly. Shared by the server (address book) and
 * the browser (trusted recipients).
 */
export const LOOKALIKE_MAX_DIFF = 4;

export function looksLike(a: string, b: string): boolean {
  const x = a.toLowerCase().slice(2);
  const y = b.toLowerCase().slice(2);
  if (x === y) return false;
  if (x.slice(0, 3) === y.slice(0, 3) && x.slice(-3) === y.slice(-3)) return true;
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
  return diff <= LOOKALIKE_MAX_DIFF;
}
