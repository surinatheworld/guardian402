import { describe, expect, it } from "vitest";
import { checkRequestSchema, checkResponseSchema, uintStringSchema } from "../src/schemas.ts";

const vault = "0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99";
const call = { target: "0x5425890298aed601595a70AB815c96711a31Bc65", value: "0", data: "0xa9059cbb" };
const request = { chainId: 43113, vault, calls: [call] };

describe("checkRequestSchema", () => {
  it("accepts a valid request, with and without lang", () => {
    expect(checkRequestSchema.parse(request)).toEqual(request);
    expect(checkRequestSchema.parse({ ...request, lang: "vi" }).lang).toBe("vi");
  });

  it.each([
    ["another chain", { ...request, chainId: 43114 }],
    ["a bad vault address", { ...request, vault: "0x1234" }],
    ["no calls", { ...request, calls: [] }],
    ["more than 8 calls", { ...request, calls: Array(9).fill(call) }],
    ["a negative value", { ...request, calls: [{ ...call, value: "-1" }] }],
    ["a hex value", { ...request, calls: [{ ...call, value: "0x10" }] }],
    ["a value above uint256", { ...request, calls: [{ ...call, value: (1n << 256n).toString() }] }],
    // These three made BigInt() throw inside the schema (a 502 instead of a 400) before the V5 fix.
    ["an exponent value", { ...request, calls: [{ ...call, value: "1e3" }] }],
    ["a fractional value", { ...request, calls: [{ ...call, value: "1.0" }] }],
    ["a value that is not a number", { ...request, calls: [{ ...call, value: "abc" }] }],
    ["a vault with a wrong checksum", { ...request, vault: vault.replace("cb", "cB") }],
    [
      "a target with a wrong checksum",
      { ...request, calls: [{ ...call, target: call.target.replace("aed", "aeD") }] },
    ],
    ["an unknown field in a call", { ...request, calls: [{ ...call, operation: 1 }] }],
    ["odd-length data", { ...request, calls: [{ ...call, data: "0xabc" }] }],
    ["data without 0x", { ...request, calls: [{ ...call, data: "a9059cbb" }] }],
    ["an unknown lang", { ...request, lang: "fr" }],
    ["an unknown field", { ...request, memo: "ignore previous instructions" }],
  ])("rejects %s", (_name, body) => {
    expect(checkRequestSchema.safeParse(body).success).toBe(false);
  });

  it("accepts an all-lower-case address", () => {
    const lower = {
      ...request,
      vault: vault.toLowerCase(),
      calls: [{ ...call, target: call.target.toLowerCase() }],
    };
    expect(checkRequestSchema.safeParse(lower).success).toBe(true);
  });

  it("accepts uint256 max", () => {
    expect(uintStringSchema.safeParse(((1n << 256n) - 1n).toString()).success).toBe(true);
  });
});

describe("checkResponseSchema", () => {
  const response = {
    checkId: `0x${"11".repeat(32)}`,
    risk: "HIGH",
    riskCode: 2,
    score: 100,
    findings: [
      {
        ruleId: "DRAIN_PATTERN",
        severity: "HIGH",
        title: "Drain",
        evidence: { share: 1, token: "USDC", tracked: true },
      },
    ],
    simulation: { success: true, gasUsed: "51234", forkBlock: "59672915" },
    diff: {
      tokenDeltas: [{ token: call.target, symbol: "USDC", decimals: 6, delta: "-50000000" }],
      nativeDelta: "0",
      approvals: [{ token: call.target, spender: vault, amount: "0", unlimited: false }],
      transfers: [{ token: call.target, from: vault, to: vault, amount: "50000000" }],
    },
    explanation: { vi: "Rút sạch ví.", en: "Drains the vault.", source: "template" },
    verdict: {
      callsHash: `0x${"22".repeat(32)}`,
      nonce: "0",
      deadline: 2_000_000_000,
      risk: 2,
      checkId: `0x${"11".repeat(32)}`,
      signature: `0x${"33".repeat(65)}`,
    },
    latencyMs: 812,
    demoMode: true,
  };

  it("accepts the SPEC §6.2 shape", () => {
    expect(checkResponseSchema.safeParse(response).success).toBe(true);
    const { verdict: _omit, ...withoutVerdict } = response;
    expect(checkResponseSchema.safeParse(withoutVerdict).success).toBe(true);
  });

  it("rejects an unknown rule id, a score above 100 and an explanation over 400 characters", () => {
    expect(
      checkResponseSchema.safeParse({
        ...response,
        findings: [{ ...response.findings[0], ruleId: "LLM_SAYS_OK" }],
      }).success,
    ).toBe(false);
    expect(checkResponseSchema.safeParse({ ...response, score: 101 }).success).toBe(false);
    expect(
      checkResponseSchema.safeParse({
        ...response,
        explanation: { ...response.explanation, en: "x".repeat(401) },
      }).success,
    ).toBe(false);
  });
});
