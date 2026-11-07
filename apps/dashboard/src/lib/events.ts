"use client";
// AgentVault `Executed` events. The public Fuji RPC caps eth_getLogs at 100 blocks, so on Fuji the events come
// from Routescan's Etherscan-compatible API (the backend of testnet.snowtrace.io, no key, open CORS) in one
// request. On the local fork, the last 100 blocks are read from the fork RPC.
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { decodeEventLog, getAbiItem, toEventSelector, type Hex } from "viem";
import { agentVaultAbi } from "@guardian402/shared";
import { deployment, NETWORK } from "./config";

const ROUTESCAN = "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api";
const WANT = 20;
const executed = getAbiItem({ abi: agentVaultAbi, name: "Executed" });

export type ExecutedEvent = {
  txHash: Hex;
  blockNumber: bigint;
  timeMs?: number;
  checkId: Hex;
  withVerdict: boolean;
  nonceUsed: bigint;
};

type RoutescanLog = {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  timeStamp: Hex;
  transactionHash: Hex;
};

export async function fetchExecutedFromRoutescan(fetcher: typeof fetch = fetch): Promise<ExecutedEvent[]> {
  const url = new URL(ROUTESCAN);
  url.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: deployment.vault,
    topic0: toEventSelector(executed),
    fromBlock: String(deployment.startBlock),
    toBlock: "latest",
  }).toString();
  const res = await fetcher(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Routescan HTTP ${res.status}`);
  const body = (await res.json()) as { status: string; message: string; result: RoutescanLog[] | string };
  // "No records found" comes back as status 0 with an empty result.
  if (!Array.isArray(body.result)) {
    if (/no records/i.test(body.message)) return [];
    throw new Error(`Routescan: ${typeof body.result === "string" ? body.result : body.message}`);
  }
  return body.result
    .map((l) => {
      const { args } = decodeEventLog({
        abi: [executed],
        topics: l.topics as [Hex, ...Hex[]],
        data: l.data === ("" as Hex) ? "0x" : l.data,
      });
      return {
        txHash: l.transactionHash,
        blockNumber: BigInt(l.blockNumber),
        timeMs: Number(BigInt(l.timeStamp)) * 1000,
        checkId: args.checkId,
        withVerdict: args.withVerdict,
        nonceUsed: args.nonceUsed,
      };
    })
    .reverse()
    .slice(0, WANT);
}

export function useExecutedEvents() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["vault", "executed", NETWORK],
    refetchInterval: 15_000,
    queryFn: async (): Promise<ExecutedEvent[]> => {
      if (NETWORK === "fuji") return fetchExecutedFromRoutescan();
      if (!client) return [];
      const to = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: deployment.vault,
        event: executed,
        fromBlock: to > 99n ? to - 99n : 0n,
        toBlock: to,
      });
      return logs
        .filter((l) => l.transactionHash && l.blockNumber !== null)
        .map((l) => ({
          txHash: l.transactionHash as Hex,
          blockNumber: l.blockNumber as bigint,
          checkId: l.args.checkId ?? "0x",
          withVerdict: l.args.withVerdict ?? false,
          nonceUsed: l.args.nonceUsed ?? 0n,
        }))
        .reverse()
        .slice(0, WANT);
    },
  });
}
