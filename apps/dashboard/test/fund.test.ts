import { encodeEventTopics, getAbiItem, toEventSelector } from "viem";
import { describe, expect, it } from "vitest";
import { vaultFactoryAbi } from "@guardian402/shared";
import { AGENT_FEE_AVAX, AGENT_FEE_USDC } from "../src/lib/balances";
import { fundingPlan } from "../src/components/fund";
import { fetchFactoryStats, fetchVaultsWithAgent } from "../src/lib/events";

describe("one press to fund", () => {
  it("deposits, then tops up only the fees the agent lacks", () => {
    expect(fundingPlan({ deposit: 10_000_000n, agentAvax: 0n, agentUsdc: 0n })).toEqual([
      "deposit",
      "gas",
      "fee",
    ]);
    expect(
      fundingPlan({ deposit: 10_000_000n, agentAvax: AGENT_FEE_AVAX, agentUsdc: AGENT_FEE_USDC }),
    ).toEqual(["deposit"]);
    expect(fundingPlan({ deposit: 0n, agentAvax: 0n, agentUsdc: AGENT_FEE_USDC })).toEqual(["gas"]);
    // Balances not read yet: never send a fee on a guess.
    expect(fundingPlan({ deposit: 1n, agentAvax: undefined, agentUsdc: undefined })).toEqual(["deposit"]);
  });
});

describe("an owner wallet that is another vault's agent", () => {
  it("asks Routescan for VaultCreated with that agent and returns the vaults", async () => {
    const seen: URL[] = [];
    const vault = "0xB0dc640443190fFED9126e6157068C5364B0Ef4a";
    const fetcher = (async (input: URL | RequestInfo) => {
      seen.push(new URL(String(input)));
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              topics: [
                toEventSelector(getAbiItem({ abi: vaultFactoryAbi, name: "VaultCreated" })),
                `0x${"0".repeat(24)}54a2276f134d3cfaa7572bc326092faba6352888`,
                `0x${"0".repeat(24)}${vault.slice(2).toLowerCase()}`,
                `0x${"0".repeat(24)}419ef6cc38e492b390c42f3dd25b3d0a6ad6cf60`,
              ],
              data: `0x${"0".repeat(24)}1d59bb3fa561f17f4b33eda7ed9c81cf688a3584`,
              blockNumber: "0x1",
              timeStamp: "0x1",
              transactionHash: `0x${"ab".repeat(32)}`,
            },
          ],
        }),
      );
    }) as typeof fetch;
    const vaults = await fetchVaultsWithAgent("0x419Ef6cC38E492B390c42F3dd25B3D0A6ad6Cf60", fetcher);
    expect(vaults).toEqual([vault]);
    expect(seen[0]?.searchParams.get("topic3")).toBe(
      `0x${"0".repeat(24)}419ef6cc38e492b390c42f3dd25b3d0a6ad6cf60`,
    );
  });
});

describe("vaults created through the factory", () => {
  it("counts VaultCreated logs, distinct owners and distinct agents", async () => {
    const event = getAbiItem({ abi: vaultFactoryAbi, name: "VaultCreated" });
    const log = (owner: string, vault: string, agent: string) => ({
      topics: encodeEventTopics({
        abi: [event],
        eventName: "VaultCreated",
        args: { owner, vault, agent } as never,
      }),
      // guardian, the one non-indexed field
      data: `0x${"0".repeat(24)}${"7".repeat(40)}`,
      blockNumber: "0x1",
      timeStamp: "0x1",
      transactionHash: `0x${"1".repeat(64)}`,
    });
    const O1 = "0x1111111111111111111111111111111111111111";
    const O2 = "0x2222222222222222222222222222222222222222";
    const A = "0x3333333333333333333333333333333333333333";
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          status: "1",
          result: [
            log(O1, "0x4444444444444444444444444444444444444444", A),
            log(O1, "0x5555555555555555555555555555555555555555", A),
            log(O2, "0x6666666666666666666666666666666666666666", A),
          ],
        }),
      )) as typeof fetch;
    expect(await fetchFactoryStats(fetcher)).toEqual({ vaults: 3, owners: 2, agents: 1 });
    const none = (async () =>
      new Response(JSON.stringify({ status: "0", message: "No records found", result: [] }))) as typeof fetch;
    expect(await fetchFactoryStats(none)).toEqual({ vaults: 0, owners: 0, agents: 0 });
  });
});
