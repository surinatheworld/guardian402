"use client";
// AgentVault `Executed` events. The public Fuji RPC caps eth_getLogs at 100 blocks, so on Fuji the events come
// from Routescan's Etherscan-compatible API (the backend of testnet.snowtrace.io, no key, open CORS) in one
// request. On the local fork, the last 100 blocks are read from the fork RPC.
// Routescan caches a getLogs answer per URL: with `toBlock=latest` the same URL keeps returning an old answer
// (a payment made an hour earlier was still missing), so the query names the current block number instead.
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { decodeEventLog, getAbiItem, pad, toEventSelector, type Hex, type Address } from "viem";
import { agentVaultAbi, vaultFactoryAbi } from "@guardian402/shared";
import { deployment, NETWORK } from "./config";
import { useSelectedVault } from "./vault-context";

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

export async function fetchExecutedFromRoutescan(
  fetcher: typeof fetch = fetch,
  vault: Address = deployment.vault,
  /** The chain head; without it the query falls back to `latest` (cached by Routescan, may be stale). */
  toBlock?: bigint,
): Promise<ExecutedEvent[]> {
  const url = new URL(ROUTESCAN);
  url.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: vault,
    topic0: toEventSelector(executed),
    fromBlock: vault.toLowerCase() === deployment.vault.toLowerCase() ? String(deployment.startBlock) : "0",
    toBlock: toBlock === undefined ? "latest" : toBlock.toString(),
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
  const { address: vault } = useSelectedVault();
  return useQuery({
    queryKey: ["vault", "executed", NETWORK, vault],
    refetchInterval: 15_000,
    queryFn: async (): Promise<ExecutedEvent[]> => {
      if (NETWORK === "fuji") {
        const head = client ? await client.getBlockNumber().catch(() => undefined) : undefined;
        return fetchExecutedFromRoutescan(fetch, vault, head);
      }
      if (!client) return [];
      const to = await client.getBlockNumber();
      const from = to > 99n ? to - 99n : 0n;
      const range = (fromBlock: bigint, toBlock: bigint) =>
        client.getLogs({ address: vault, event: executed, fromBlock, toBlock });
      // The fork forwards blocks before its fork point to its upstream RPC, and some upstreams (free tiers)
      // refuse more than 10 blocks per eth_getLogs. Then read the same 100 blocks in 10-block slices.
      const logs = await range(from, to).catch(async () => {
        const slices: Promise<Awaited<ReturnType<typeof range>>>[] = [];
        for (let a = from; a <= to; a += 10n) {
          const b = a + 9n < to ? a + 9n : to;
          slices.push(range(a, b).catch(() => []));
        }
        return (await Promise.all(slices)).flat();
      });
      const recent = logs
        .filter((l) => l.transactionHash && l.blockNumber !== null)
        .reverse()
        .slice(0, WANT);
      // Block times, so fork events sort with the Guardian's checks (at most WANT blocks, fork-local RPC).
      const times = new Map<bigint, number>();
      await Promise.all(
        [...new Set(recent.map((l) => l.blockNumber as bigint))].map(async (n) => {
          const block = await client.getBlock({ blockNumber: n }).catch(() => null);
          if (block) times.set(n, Number(block.timestamp) * 1000);
        }),
      );
      return recent.map((l) => {
        const timeMs = times.get(l.blockNumber as bigint);
        return {
          txHash: l.transactionHash as Hex,
          blockNumber: l.blockNumber as bigint,
          ...(timeMs ? { timeMs } : {}),
          checkId: l.args.checkId ?? "0x",
          withVerdict: l.args.withVerdict ?? false,
          nonceUsed: l.args.nonceUsed ?? 0n,
        };
      });
    },
  });
}

const vaultCreated = getAbiItem({ abi: vaultFactoryAbi, name: "VaultCreated" });

/**
 * Vaults the factory created with `wallet` as their agent (VaultCreated indexes the agent), from Routescan on
 * Fuji. Used to warn an owner who is about to use an agent wallet as the owner of a new vault. Fuji only.
 */
export async function fetchVaultsWithAgent(
  wallet: Address,
  fetcher: typeof fetch = fetch,
  /** The chain head: Routescan caches an answer per URL, so a fixed toBlock can return an old list. */
  toBlock?: bigint,
): Promise<Address[]> {
  if (!deployment.factory) return [];
  const url = new URL(ROUTESCAN);
  url.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: deployment.factory,
    topic0: toEventSelector(vaultCreated),
    topic3: pad(wallet.toLowerCase() as Hex, { size: 32 }),
    topic0_3_opr: "and",
    fromBlock: String(deployment.factoryStartBlock ?? 0),
    toBlock: toBlock === undefined ? "99999999" : toBlock.toString(),
  }).toString();
  const res = await fetcher(url, { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json()) as { result: RoutescanLog[] | string };
  if (!Array.isArray(body.result)) return [];
  return body.result.flatMap((l) => {
    try {
      const { args } = decodeEventLog({
        abi: [vaultCreated],
        topics: l.topics as [Hex, ...Hex[]],
        data: l.data,
      });
      return [args.vault as Address];
    } catch {
      return []; // not a VaultCreated log: a warning helper never fails the page
    }
  });
}

export function useVaultsWithAgent(wallet: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["factory", "vaults-with-agent", wallet],
    queryFn: async () => {
      const head = client ? await client.getBlockNumber().catch(() => undefined) : undefined;
      return fetchVaultsWithAgent(wallet as Address, fetch, head);
    },
    enabled: NETWORK === "fuji" && Boolean(wallet),
    staleTime: 60_000,
  });
}

export type FactoryStats = {
  vaults: number;
  owners: number;
  agents: number;
  /** Lowercase owner wallets of the factory's vaults (the reputation page counts only their feedback). */
  ownerWallets: string[];
};

/** Every vault the VaultFactory has created on Fuji, from Routescan: how many, and for how many owners and agents. */
export async function fetchFactoryStats(
  fetcher: typeof fetch = fetch,
  /** The chain head: Routescan caches an answer per URL, so a fixed toBlock kept answering 10 vaults after the 11th. */
  toBlock?: bigint,
): Promise<FactoryStats | null> {
  if (!deployment.factory) return null;
  const url = new URL(ROUTESCAN);
  url.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: deployment.factory,
    topic0: toEventSelector(vaultCreated),
    fromBlock: String(deployment.factoryStartBlock ?? 0),
    toBlock: toBlock === undefined ? "99999999" : toBlock.toString(),
  }).toString();
  const res = await fetcher(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Routescan HTTP ${res.status}`);
  const body = (await res.json()) as { message?: string; result: RoutescanLog[] | string };
  if (!Array.isArray(body.result)) {
    if (/no records/i.test(body.message ?? "")) return { vaults: 0, owners: 0, agents: 0, ownerWallets: [] };
    throw new Error("Routescan: no result");
  }
  const owners = new Set<string>();
  const agents = new Set<string>();
  let vaults = 0;
  for (const l of body.result) {
    try {
      const { args } = decodeEventLog({
        abi: [vaultCreated],
        topics: l.topics as [Hex, ...Hex[]],
        data: l.data,
      });
      vaults += 1;
      owners.add(String(args.owner).toLowerCase());
      agents.add(String(args.agent).toLowerCase());
    } catch {
      // not a VaultCreated log
    }
  }
  return { vaults, owners: owners.size, agents: agents.size, ownerWallets: [...owners] };
}

/** Always Fuji's factory (Routescan), whatever network the dashboard runs on. */
export function useFactoryStats() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["factory", "stats"],
    queryFn: async () => {
      const head = client ? await client.getBlockNumber().catch(() => undefined) : undefined;
      return fetchFactoryStats(fetch, head);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
