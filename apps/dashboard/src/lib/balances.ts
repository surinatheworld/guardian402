"use client";
// AVAX and USDC balances of any address on Fuji (owner wallet, vault, agent wallet), refreshed every 10 s, and
// where a newcomer gets test tokens.
import { erc20Abi, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { deployment } from "./config";

export function useBalances(address: Address | undefined) {
  const enabled = Boolean(address);
  const avax = useBalance({
    address,
    chainId: avalancheFuji.id,
    query: { enabled, refetchInterval: 10_000 },
  });
  const usdc = useReadContract({
    address: deployment.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: avalancheFuji.id,
    query: { enabled, refetchInterval: 10_000 },
  });
  return {
    avax: avax.data?.value,
    usdc: usdc.data,
    isPending: enabled && (avax.isPending || usdc.isPending),
    isError: avax.isError || usdc.isError,
    refetch: () => {
      void avax.refetch();
      void usdc.refetch();
    },
  };
}

/** Test-token faucets for Avalanche Fuji (free; no real money). */
export const FAUCET = {
  avax: "https://core.app/tools/testnet-faucet/?subnet=c&token=c",
  usdc: "https://faucet.circle.com/",
} as const;

/** Gas a vault creation and a few owner transactions need, with room to spare (wei). */
export const OWNER_GAS_MIN = 20_000_000_000_000_000n; // 0.02 AVAX
/** What the agent wallet needs to run: gas for its payments and USDC for Guardian fees. */
export const AGENT_FEE_AVAX = 50_000_000_000_000_000n; // 0.05 AVAX ≈ dozens of payments
export const AGENT_FEE_USDC = 1_000_000n; // 1 USDC = 100 approvals at 0.01 USDC
