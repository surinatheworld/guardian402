import { decodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { getAddresses, mockRouterAbi, parseNetwork } from "@guardian402/shared";
import { lookalike, planFromInjection, planSafeDca } from "../src/planner.ts";
import { EXPECTED } from "../src/scenarios.ts";
import lookalikeFixture from "../fixtures/lookalike.json" with { type: "json" };

const d = getAddresses(parseNetwork(lookalikeFixture.network));

describe("safe planner", () => {
  it("plans approve + swap through pool 0 when the price is below the threshold", () => {
    const calls = planSafeDca(d, { price: 25_000_000n, maxPrice: 30_000_000n, amount: 2_000_000n });
    expect(calls.map((c) => c.target)).toEqual([d.usdc, d.router]);
    const a = decodeFunctionData({ abi: erc20Abi, data: calls[0]?.data ?? "0x" });
    expect(a.args).toEqual([d.router, 2_000_000n]);
    const s = decodeFunctionData({ abi: mockRouterAbi, data: calls[1]?.data ?? "0x" });
    expect(s.functionName).toBe("swapExactIn");
    expect(s.args?.[4]).toBe(0);
  });

  it("plans nothing above the threshold", () => {
    expect(planSafeDca(d, { price: 31_000_000n, maxPrice: 30_000_000n, amount: 1n })).toEqual([]);
  });
});

describe("scripted-attack planner (DEMO)", () => {
  it("turns the drain item into a transfer of the whole balance", () => {
    const [call] = planFromInjection(d, "drain", 48_000_000n);
    const t = decodeFunctionData({ abi: erc20Abi, data: call?.data ?? "0x" });
    expect(t.functionName).toBe("transfer");
    expect(t.args?.[1]).toBe(48_000_000n);
  });

  it("turns the poison item into an unlimited approval to the lookalike, not the router", () => {
    const [call] = planFromInjection(d, "poison", 0n);
    const a = decodeFunctionData({ abi: erc20Abi, data: call?.data ?? "0x" });
    expect(a.args).toEqual([lookalike(), maxUint256]);
    expect(lookalike()).not.toBe(d.router);
    expect(lookalike().slice(2, 5).toLowerCase()).toBe(d.router.slice(2, 5).toLowerCase());
    expect(lookalike().slice(-3).toLowerCase()).toBe(d.router.slice(-3).toLowerCase());
  });

  it("ignores feed items without an instruction", () => {
    expect(planFromInjection(d, "news-1", 1n)).toEqual([]);
  });
});

it("expected table matches docs/SPEC.md §10", () => {
  expect(EXPECTED.S4).toMatchObject({ risk: "HIGH", vault: "reverted", revert: ["RiskTooHigh"] });
  expect(EXPECTED.S5.revert).toEqual(["InvalidVerdict", "VerdictExpired"]);
  expect(EXPECTED.S6.revert).toEqual(["Paused"]);
});
