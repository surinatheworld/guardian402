import { describe, expect, it } from "vitest";
import { CORE_RDNS, walletLabel, walletOptions } from "../src/lib/wallets";

const injected = { id: "injected", name: "Injected" };
const metamask = { id: "io.metamask", name: "MetaMask" };
const core = { id: CORE_RDNS, name: "Core" };

describe("wallet choice", () => {
  it("puts Core first and drops the generic connector when wallets announce themselves", () => {
    expect(walletOptions([injected, metamask, core]).map((c) => c.id)).toEqual([CORE_RDNS, "io.metamask"]);
  });

  it("falls back to the generic connector when no wallet announced itself", () => {
    expect(walletOptions([injected]).map((c) => c.id)).toEqual(["injected"]);
    expect(walletOptions([])).toEqual([]);
  });

  it("recognises Core by name too, and names the generic connector plainly", () => {
    expect(walletOptions([metamask, { id: "com.avax.core", name: "Core" }])[0]?.name).toBe("Core");
    expect(walletLabel(injected)).toBe("ví");
    expect(walletLabel(core)).toBe("Core");
  });
});
