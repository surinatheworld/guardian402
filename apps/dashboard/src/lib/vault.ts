"use client";
import { useReadContract } from "wagmi";
import { agentVaultAbi } from "@guardian402/shared";
import { useSelectedVault } from "./vault-context";

/** AgentVault.getPolicy() from the chain (Fuji, or the fork in local mode), refreshed every 10 s. */
export const useVaultPolicy = () => {
  const { address } = useSelectedVault();
  return useReadContract({
    address,
    abi: agentVaultAbi,
    functionName: "getPolicy",
    query: { refetchInterval: 10_000 },
  });
};

/**
 * AgentVault.getLimits(): per-transaction cap and total budget (SPEC §4.9). A vault deployed before it (the DEMO
 * vault) has no such function: `data` stays undefined and `unsupported` is true.
 */
export const useVaultLimits = () => {
  const { address } = useSelectedVault();
  const q = useReadContract({
    address,
    abi: agentVaultAbi,
    functionName: "getLimits",
    query: { refetchInterval: 10_000, retry: false },
  });
  return { ...q, unsupported: q.isError };
};
