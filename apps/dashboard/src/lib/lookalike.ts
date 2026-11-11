/**
 * Same first and last 3 hex characters, different address: the lookalike pattern of address poisoning. Wallets
 * show about 4+4 characters, and an attacker mines whatever is cheapest (the DEMO lookalike matches 3+3), so the
 * address book is stricter than the Guardian's production rule (4+4); a true coincidence is ~1 in 16^6 and can
 * be confirmed explicitly. Shared by the server (address book) and the browser (trusted recipients).
 */
export function looksLike(a: string, b: string): boolean {
  const x = a.toLowerCase().slice(2);
  const y = b.toLowerCase().slice(2);
  return x !== y && x.slice(0, 3) === y.slice(0, 3) && x.slice(-3) === y.slice(-3);
}
