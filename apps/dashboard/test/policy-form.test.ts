import { describe, expect, it } from "vitest";
import { assetRows, toForm, toSpec, units } from "@/components/workspace/policy-form";
import { canonicalSpec, EMPTY_SPEC, type PolicySpec } from "@/lib/policy-spec";

const VAULT = "0x0000000000000000000000000000000000000001";
const TOKEN = "0x0000000000000000000000000000000000000002";

describe("policy builder amounts", () => {
  it("rejects subunit amounts instead of rounding the user's permissions", () => {
    expect(units("0,0000010", 6, "Hạn mức")).toBe(1n);
    expect(() => units("0.0000009", 6, "Hạn mức")).toThrow(/tối đa 6/);
    expect(() => units(String(2n ** 256n), 0, "Hạn mức")).toThrow(/vượt phạm vi/);
  });

  it("round-trips existing tokens outside the catalog and a zero-cap native rule", () => {
    const spec: PolicySpec = {
      ...EMPTY_SPEC,
      tokens: [{ token: TOKEN, dailyCap: "3456", maxApproval: "123", verdictThreshold: "15" }],
      native: { dailyCap: "0", verdictThreshold: "1" },
    };
    const rows = assetRows(spec);
    const form = toForm(spec, rows);
    expect(form.assets[TOKEN]?.cap).toBe("3456");
    expect(canonicalSpec(toSpec(form, rows, VAULT))).toBe(canonicalSpec(spec));
  });
});
