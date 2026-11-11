import type { Address } from "viem";

/** Selection is valid only while it belongs to the signed-in account. */
export function resolveVault<T extends { address: Address }>(
  vaults: readonly T[],
  selected: string | null,
): T | undefined {
  return vaults.find((v) => v.address.toLowerCase() === selected?.toLowerCase()) ?? vaults[0];
}
