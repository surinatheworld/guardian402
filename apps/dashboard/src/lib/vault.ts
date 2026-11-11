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
