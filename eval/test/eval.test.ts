import { join } from "node:path";
import { decodeFunctionData, erc20Abi, getAddress, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { encodeCalls, loadCases, lookalike, placeholders } from "../src/cases.ts";
import { ROOT } from "../src/fork.ts";
import { confusion, percentile, blockedAtHigh, blockedAtMedium } from "../src/metrics.ts";

const cases = loadCases(join(ROOT, "eval/cases"));

describe("case set (docs/SPEC.md §12)", () => {
  it("has at least 40 cases with the required mix", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const n = (label: string, category?: string) =>
      cases.filter((c) => c.label === label && (!category || c.category === category)).length;
    expect(n("benign")).toBeGreaterThanOrEqual(15);
    expect(n("malicious")).toBeGreaterThanOrEqual(25);
    expect(n("malicious", "unlimited-approval")).toBeGreaterThanOrEqual(5);
    expect(n("malicious", "lookalike")).toBeGreaterThanOrEqual(5);
    expect(n("malicious", "drain")).toBeGreaterThanOrEqual(5);
    expect(n("malicious", "bad-slippage")).toBeGreaterThanOrEqual(5);
    expect(n("malicious", "unknown-contract")).toBeGreaterThanOrEqual(3);
    expect(n("malicious", "reverting")).toBeGreaterThanOrEqual(2);
  });

  it("every case encodes with the placeholders the runner provides", () => {
    const a = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "1")}`);
    const p = placeholders({
      usdc: a(1),
      mWAVAX: a(2),
      router: a(3),
      oracle: a(4),
      vault: a(5),
      treasury: a(6),
      attacker: a(7),
      unknownRouter: a(8),
      unknownToken: a(9),
      lookalikeRouter: a(10),
      lookalikeTreasury: a(11),
      lookalikeVault: a(12),
      vaultUsdc: "50000000",
    });
    for (const c of cases) expect(() => encodeCalls(c, p), c.id).not.toThrow();
    const m01 = cases.find((c) => c.id === "m01-approve-router-max");
    if (!m01) throw new Error("case m01 is missing");
    const [call] = encodeCalls(m01, p);
    expect(decodeFunctionData({ abi: erc20Abi, data: call?.data ?? "0x" }).args).toEqual([a(3), maxUint256]);
  });
});

describe("lookalike", () => {
  it("keeps 4 characters at each end and changes every character in between", () => {
    const of = "0x8423a28a9af70039f27882eb35c3af8f672bc550";
    const l = lookalike(getAddress(of)).toLowerCase();
    expect(l.slice(2, 6)).toBe(of.slice(2, 6));
    expect(l.slice(-4)).toBe(of.slice(-4));
    for (let i = 6; i < 38; i++) expect(l[i]).not.toBe(of[i]);
  });
});

describe("metrics", () => {
  const outcomes = [
    { id: "a", label: "malicious", risk: "HIGH" },
    { id: "b", label: "malicious", risk: "MEDIUM" },
    { id: "c", label: "benign", risk: "LOW" },
    { id: "d", label: "benign", risk: "MEDIUM" },
  ] as const;

  it("counts blocked = HIGH and blocked ≥ MEDIUM", () => {
    expect(confusion(outcomes, blockedAtHigh)).toMatchObject({
      tp: 1,
      fn: 1,
      tn: 2,
      fp: 0,
      precision: 1,
      recall: 0.5,
    });
    expect(confusion(outcomes, blockedAtMedium)).toMatchObject({
      tp: 2,
      fn: 0,
      tn: 1,
      fp: 1,
      falsePositiveRate: 0.5,
    });
  });

  it("percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 95)).toBe(0);
  });
});
