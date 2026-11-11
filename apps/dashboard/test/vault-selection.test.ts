import { describe, expect, it } from "vitest";
import { resolveVault } from "../src/lib/vault-selection";

const vaults = [
  { address: "0x00000000000000000000000000000000000000aA" as const },
  { address: "0x00000000000000000000000000000000000000bB" as const },
] as const;

describe("vault selection", () => {
  it("keeps a linked vault regardless of address casing", () => {
    expect(resolveVault(vaults, vaults[1].address.toLowerCase())).toEqual(vaults[1]);
  });
  it("never retains an unlinked vault after account or ownership changes", () => {
    expect(resolveVault(vaults.slice(0, 1), vaults[1].address)).toEqual(vaults[0]);
    expect(resolveVault([], vaults[1].address)).toBeUndefined();
  });
});
