import { readFileSync } from "node:fs";
import { decodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { checkRequestSchema, FUJI_CHAIN_ID, getAddresses, RULE_IDS } from "@guardian402/shared";
import { formatAmount, isUnlimited, shortHex } from "../src/lib/format";
import { RULE_LABEL, revertLabel } from "../src/lib/labels";
import { LOOKALIKE, PRESETS } from "../src/lib/presets";

const d = getAddresses("fuji");

describe("format", () => {
  it("uses a Vietnamese decimal comma and trims trailing zeros", () => {
    expect(formatAmount(2_000_000n, 6)).toBe("2");
    expect(formatAmount("79760000000000000", 18, 5)).toBe("0,07976");
    expect(formatAmount(-48_000_000n, 6)).toBe("-48");
    expect(formatAmount(1_234_500_000n, 6)).toBe("1.234,5");
  });

  it("flags unlimited approvals and shortens hex", () => {
    expect(isUnlimited(maxUint256)).toBe(true);
    expect(isUnlimited(10n ** 30n)).toBe(false);
    expect(shortHex(d.vault)).toBe(`${d.vault.slice(0, 6)}…${d.vault.slice(-4)}`);
  });
});

describe("labels", () => {
  it("has a Vietnamese label for every rule", () => {
    expect(Object.keys(RULE_LABEL).sort()).toEqual([...RULE_IDS].sort());
  });

  it("names known vault errors and keeps unknown ones", () => {
    expect(revertLabel("RiskTooHigh")).toContain("rủi ro");
    expect(revertLabel("Whatever")).toBe("Whatever");
    expect(revertLabel(undefined)).toBe("không rõ lý do");
  });
});

describe("presets", () => {
  it("are valid CheckRequests", () => {
    for (const p of PRESETS) {
      const req = { chainId: FUJI_CHAIN_ID, vault: d.vault, calls: p.calls(d, 48_000_000n) };
      expect(checkRequestSchema.safeParse(req).success, p.id).toBe(true);
    }
  });

  it("S3 approves the lookalike from apps/agent/fixtures/lookalike.json", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../agent/fixtures/lookalike.json", import.meta.url), "utf8"),
    ) as { lookalike: string };
    expect(LOOKALIKE).toBe(fixture.lookalike);
    const s3 = PRESETS.find((p) => p.id === "S3")?.calls(d, 0n)[0];
    expect(decodeFunctionData({ abi: erc20Abi, data: s3?.data ?? "0x" }).args).toEqual([
      LOOKALIKE,
      maxUint256,
    ]);
  });
});
