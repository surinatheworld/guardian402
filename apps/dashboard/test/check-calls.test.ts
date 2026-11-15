import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi, maxUint256, type Address } from "viem";
import {
  approveCall,
  describeCall,
  parseCalls,
  rawCall,
  transferCall,
  vaultDecision,
} from "@/lib/check-calls";

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
      text: "Két sẽ từ chối giao dịch này: bên được cấp quyền rút không được phép.",
    });
  });

  it("then compares the risk with the vault's maxAgentRisk", () => {
    expect(vaultDecision({ findings: [], riskCode: 2 }, 1).blocked).toBe(true);
    expect(vaultDecision({ findings: [], riskCode: 1 }, 1)).toEqual({
      blocked: false,
      text: "Quy tắc của két không chặn giao dịch này.",
    });
    expect(vaultDecision({ findings: [], riskCode: 2 }, undefined).blocked).toBe(false);
  });
});

describe("wallet check builders", () => {
  const USDC_ADDR = "0x5425890298aed601595a70AB815c96711a31Bc65";
  const SPENDER = "0x1111111111111111111111111111111111111111";

  it("builds an unlimited or a capped approval", () => {
    const max = approveCall(USDC_ADDR, 6, SPENDER, "", true);
    if (!max.ok) throw new Error(max.error);
    const a = decodeFunctionData({ abi: erc20Abi, data: max.value[0]?.data ?? "0x" });
    expect(a.functionName).toBe("approve");
    expect(a.args?.[1]).toBe(2n ** 256n - 1n);
    const capped = approveCall(USDC_ADDR, 6, SPENDER, "2,5", false);
    if (!capped.ok) throw new Error(capped.error);
    expect(decodeFunctionData({ abi: erc20Abi, data: capped.value[0]?.data ?? "0x" }).args?.[1]).toBe(
      2_500_000n,
    );
    expect(approveCall(USDC_ADDR, 6, "nope", "1", false).ok).toBe(false);
    expect(approveCall(USDC_ADDR, 6, SPENDER, "1.1234567", false).ok).toBe(false);
  });

  it("takes a raw transaction as a wallet shows it", () => {
    expect(rawCall(SPENDER, "0,5", "0xabcd")).toEqual({
      ok: true,
      value: [{ target: SPENDER, value: "500000000000000000", data: "0xabcd" }],
    });
    expect(rawCall(SPENDER, "", "")).toMatchObject({ ok: true, value: [{ value: "0", data: "0x" }] });
    expect(rawCall(SPENDER, "1", "0xabc").ok).toBe(false);
    expect(rawCall("0x12", "1", "0x").ok).toBe(false);
  });
});
