import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi, maxUint256, type Address } from "viem";
import { describeCall, parseCalls, transferCall, vaultDecision } from "@/lib/check-calls";

const USDC: Address = "0x5425890298aed601595a70AB815c96711a31Bc65";
const LOOKALIKE: Address = "0xE20b3196DcAf7663E8E834bA881a513cF761d1d9";
const meta = (a: Address) =>
  a.toLowerCase() === USDC.toLowerCase() ? { symbol: "USDC", decimals: 6 } : undefined;

describe("calls JSON", () => {
  it("accepts 1–8 calls and normalises addresses, value and data", () => {
    const r = parseCalls(JSON.stringify([{ target: USDC.toLowerCase() }]));
    expect(r).toEqual({ ok: true, value: [{ target: USDC, value: "0", data: "0x" }] });
  });

  it("explains what is wrong, by call", () => {
    expect(parseCalls("[{")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON không hợp lệ/) });
    expect(parseCalls("[]")).toMatchObject({ ok: false, error: expect.stringMatching(/từ 1 tới 8/) });
    expect(parseCalls(JSON.stringify(Array(9).fill({ target: USDC })))).toMatchObject({ ok: false });
    expect(parseCalls(JSON.stringify([{ target: USDC }, { target: "0x12" }]))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Lệnh 2: target/),
    });
    expect(parseCalls(JSON.stringify([{ target: USDC, value: "-1" }]))).toMatchObject({ ok: false });
    expect(parseCalls(JSON.stringify([{ target: USDC, data: "0xabc" }]))).toMatchObject({ ok: false });
  });
});

describe("USDC transfer form", () => {
  it("encodes transfer(to, amount) on the token, with a comma or a dot", () => {
    const r = transferCall(USDC, 6, LOOKALIKE.toLowerCase(), "1,5");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    const [call] = r.value;
    if (!call) return;
    expect(call.target).toBe(USDC);
    const d = decodeFunctionData({ abi: erc20Abi, data: call.data });
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([LOOKALIKE, 1_500_000n]);
  });

  it("refuses zero, extra decimals and bad recipients instead of rounding", () => {
    expect(transferCall(USDC, 6, LOOKALIKE, "0").ok).toBe(false);
    expect(transferCall(USDC, 6, LOOKALIKE, "0.0000001").ok).toBe(false);
    expect(transferCall(USDC, 6, "0x1234", "1").ok).toBe(false);
    expect(transferCall(USDC, 6, LOOKALIKE, "abc").ok).toBe(false);
  });
});

describe("call preview", () => {
  it("names ERC-20 calls and unlimited approvals", () => {
    const approve = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [LOOKALIKE, maxUint256],
    });
    expect(describeCall({ target: USDC, value: "0", data: approve }, meta)).toBe(
      "USDC.approve(0xE20b…d1d9, không giới hạn)",
    );
    const transfer = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [LOOKALIKE, 1_500_000n],
    });
    expect(describeCall({ target: USDC, value: "0", data: transfer }, meta)).toBe(
      "USDC.transfer(0xE20b…d1d9, 1,5 USDC)",
    );
  });
});

describe("vault decision", () => {
  const precheck = (reason: string) => ({
    ruleId: "POLICY_PRECHECK" as const,
    severity: "HIGH" as const,
    title: `Vault policy would reject the batch: ${reason}`,
    evidence: { reason },
  });

  it("uses the static policy reasons first", () => {
    expect(vaultDecision({ findings: [precheck("spender-not-allowed")], riskCode: 2 }, 0)).toEqual({
      blocked: true,
      text: "Vault sẽ từ chối lô lệnh này: bên được cấp quyền không được phép.",
    });
  });

  it("then compares the risk with the vault's maxAgentRisk", () => {
    expect(vaultDecision({ findings: [], riskCode: 2 }, 1).blocked).toBe(true);
    expect(vaultDecision({ findings: [], riskCode: 1 }, 1)).toEqual({
      blocked: false,
      text: "Luật của vault không chặn lô lệnh này.",
    });
    expect(vaultDecision({ findings: [], riskCode: 2 }, undefined).blocked).toBe(false);
  });
});
