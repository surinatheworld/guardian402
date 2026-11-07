"use client";
import { useReadContract } from "wagmi";
import { agentVaultAbi } from "@guardian402/shared";
import { deployment } from "./config";

/** AgentVault.getPolicy() from the chain (Fuji, or the fork in local mode), refreshed every 10 s. */
export const useVaultPolicy = () =>
  useReadContract({
    address: deployment.vault,
    abi: agentVaultAbi,
    functionName: "getPolicy",
    query: { refetchInterval: 10_000 },
  });
