import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { signVerdict } from "../src/sign.ts";
import {
  CALL_TUPLE,
  hashCalls,
  recoverVerdictSigner,
  toCalls,
  verdictDomain,
  verdictTypes,
  type Call,
  type VerdictMessage,
} from "../src/verdict.ts";

// Test-only key, never funded.
const guardian = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000006a12d1a4");
const vault = "0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99";
const calls: Call[] = [
  { target: "0x5425890298aed601595a70AB815c96711a31Bc65", value: 0n, data: "0xa9059cbb" },
  { target: "0x263a18Df9E627A862880Ec79E11aAC8671509355", value: 1000n, data: "0x" },
];
const [c0, c1] = calls as [Call, Call];
const verdict = (over: Partial<VerdictMessage> = {}): VerdictMessage => ({
  callsHash: hashCalls(calls),
  nonce: 0n,
  deadline: 2_000_000_000n,
  risk: 0,
  checkId: keccak256(toHex("check-1")),
  ...over,
});

describe("hashCalls", () => {
  it("is keccak256(abi.encode(Call[]))", () => {
    expect(hashCalls(calls)).toBe(keccak256(encodeAbiParameters([CALL_TUPLE], [calls])));
  });

  it("hashes the empty array as abi.encode of a zero-length dynamic array", () => {
    const encoded: Hex = `0x${"20".padStart(64, "0")}${"0".repeat(64)}`;
    expect(hashCalls([])).toBe(keccak256(encoded));
  });

  it("changes with order, target, value and data", () => {
    const base = hashCalls(calls);
    expect(hashCalls([c1, c0])).not.toBe(base);
    expect(hashCalls([{ ...c0, target: vault }, c1])).not.toBe(base);
    expect(hashCalls([c0, { ...c1, value: 1001n }])).not.toBe(base);
    expect(hashCalls([{ ...c0, data: "0xa9059cbc" }, c1])).not.toBe(base);
  });

  it("toCalls converts API calls (decimal strings) to uint256", () => {
    expect(toCalls([{ target: vault, value: "1000", data: "0x" }])).toEqual([
      { target: vault, value: 1000n, data: "0x" },
    ]);
  });
});

describe("EIP-712 types and domain", () => {
  it("matches the Solidity type string", () => {
    const fields = verdictTypes.Verdict.map((f) => `${f.type} ${f.name}`).join(",");
    expect(`Verdict(${fields})`).toBe(
      "Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)",
    );
  });

  it("uses the vault domain", () => {
    expect(verdictDomain(vault, 43113)).toEqual({
      name: "Guardian402 AgentVault",
      version: "1",
      chainId: 43113,
      verifyingContract: vault,
    });
  });
});

describe("signVerdict / recoverVerdictSigner", () => {
  it("round-trips", async () => {
    const v = verdict();
    const signature = await signVerdict({ account: guardian, vault, chainId: 43113, verdict: v });
    expect(await recoverVerdictSigner({ vault, chainId: 43113, verdict: v, signature })).toBe(
      guardian.address,
    );
  });

  it.each([
    ["nonce", { nonce: 1n }],
    ["deadline", { deadline: 2_000_000_001n }],
    ["risk", { risk: 2 as const }],
    ["checkId", { checkId: keccak256(toHex("check-2")) }],
    ["callsHash", { callsHash: hashCalls([c0]) }],
  ])("recovers a different signer when %s is changed", async (_field, over) => {
    const signature = await signVerdict({ account: guardian, vault, chainId: 43113, verdict: verdict() });
    const signer = await recoverVerdictSigner({ vault, chainId: 43113, verdict: verdict(over), signature });
    expect(signer).not.toBe(guardian.address);
  });

  it("is bound to the vault and the chain", async () => {
    const signature = await signVerdict({ account: guardian, vault, chainId: 43113, verdict: verdict() });
    const otherVault = "0x0D363882aA2DdA271323F91a1a268Cd707D3C426";
    expect(
      await recoverVerdictSigner({ vault: otherVault, chainId: 43113, verdict: verdict(), signature }),
    ).not.toBe(guardian.address);
    expect(await recoverVerdictSigner({ vault, chainId: 43114, verdict: verdict(), signature })).not.toBe(
      guardian.address,
    );
  });
});
