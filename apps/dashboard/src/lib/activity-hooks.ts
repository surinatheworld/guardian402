"use client";
// Browser reads behind the activity feed. A check never changes once stored, so its detail is cached forever.
import { useQueries, useQuery } from "@tanstack/react-query";
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import type { Diff, Explanation, Finding, RiskLevel, Simulation } from "@guardian402/shared";
import { buildActivity, type ActivityItem } from "./activity";
import { getJson, useAgentHealth, useAttempts, useChecks } from "./api";
import { deployment, GUARDIAN_URL, NETWORK } from "./config";
import { useExecutedEvents } from "./events";
import { useSelectedVault } from "./vault-context";

export type CheckDetail = {
  checkId: string;
  createdAt: number;
  endpoint: string;
  vault: string;
  risk: RiskLevel;
  score: number;
  latencyMs: number;
  demo: boolean;
  findings: Finding[];
  diff: Diff;
  explanation: Explanation;
  verdict?: { nonce: string; deadline: number; risk: number; callsHash: string } | null;
  simulation?: Simulation;
  payment?: {
    createdAt: number;
    payer: string | null;
    amount: string;
    txHash: string;
    endpoint: string;
  } | null;
};

const detailQuery = (checkId: string) => ({
  queryKey: ["guardian", "check", checkId],
  queryFn: () => getJson<CheckDetail>(`${GUARDIAN_URL}/v1/checks/${checkId}`),
  staleTime: Infinity,
  gcTime: 30 * 60_000,
  retry: 1,
});

export const useCheckDetail = (checkId: string | undefined) =>
  useQuery({ ...detailQuery(checkId ?? ""), enabled: Boolean(checkId) });

/** Details of the checks on screen (titles come from their simulated money flows). */
export function useCheckDetails(checkIds: string[]) {
  const results = useQueries({ queries: checkIds.map(detailQuery) });
  const byId = new Map<string, CheckDetail>();
  results.forEach((r) => {
    if (r.data) byId.set(r.data.checkId, r.data);
  });
  return byId;
}

/** The selected vault's activity: Guardian checks, vault executions and (DEMO) agent attempts. */
export function useActivity(limit = 50) {
  const { address: vault } = useSelectedVault();
  const checks = useChecks(limit);
  const events = useExecutedEvents();
  const agent = useAgentHealth();
  const isDemoVault = vault.toLowerCase() === deployment.vault.toLowerCase();
  const attemptsOn = agent.isSuccess && isDemoVault;
  const attempts = useAttempts(attemptsOn);
  const ready = checks.isSuccess || events.isSuccess;
  const items: ActivityItem[] = ready
    ? buildActivity({
        checks: checks.data?.checks ?? [],
        executions: events.data ?? [],
        attempts: attempts.data?.attempts ?? [],
        network: NETWORK,
      })
    : [];
  return {
    items,
    isPending: checks.isPending && events.isPending,
    checksError: checks.error,
    eventsError: events.error,
    refetch: () => {
      void checks.refetch();
      void events.refetch();
      if (attemptsOn) void attempts.refetch();
    },
  };
}

/** One ERC-20 transfer out of the vault in an executed transaction. */
export type ExecutionFlow = { token: Address; to: Address; amount: bigint };

/**
 * For executions this Guardian has no check for (a small payment the vault ran without approval, or one approved
 * by another Guardian instance): what left the vault, read from the receipt's ERC-20 Transfer logs. Keyed by tx.
 */
export function useExecutionFlows(items: ActivityItem[], vault: string) {
  const client = usePublicClient();
  const txs = items.flatMap((i) => (i.execution && !i.check ? [i.execution.txHash] : []));
  const results = useQueries({
    queries: txs.map((tx) => ({
      queryKey: ["vault", "flows", tx],
      staleTime: Number.POSITIVE_INFINITY,
      enabled: Boolean(client),
      queryFn: async (): Promise<ExecutionFlow[]> => {
        if (!client) return [];
        const receipt = await client.getTransactionReceipt({ hash: tx as Hex });
        return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
          .filter((l) => l.args.from.toLowerCase() === vault.toLowerCase())
          .map((l) => ({ token: l.address, to: l.args.to, amount: l.args.value }));
      },
    })),
  });
  const byTx = new Map<string, ExecutionFlow[]>();
  results.forEach((r, i) => {
    const tx = txs[i];
    if (tx && r.data) byTx.set(tx.toLowerCase(), r.data);
  });
  return byTx;
}
