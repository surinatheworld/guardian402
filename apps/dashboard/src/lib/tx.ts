"use client";
// One wallet transaction with its state shown in place: waiting for the wallet → sent → confirmed, or failed with
// a reason the owner can act on. Used where a confirmation dialog would be one step too many (deposits, fees).
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Hex, TransactionReceipt } from "viem";
import { useChainId, usePublicClient, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";

export type TxPhase =
  | { step: "idle" }
  | { step: "wallet" }
  | { step: "mining"; hash: Hex }
  | { step: "unknown"; hash: Hex }
  | { step: "done"; hash: Hex; receipt: TransactionReceipt }
  | { step: "failed"; message: string; hash?: Hex };

export function walletErrorText(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
  if (/user rejected|denied|rejected the request/i.test(text))
    return "Bạn đã từ chối trong ví. Chưa có gì thay đổi.";
  if (/insufficient funds/i.test(text))
    return "Ví không đủ AVAX để trả phí mạng. Lấy thêm AVAX thử nghiệm rồi thử lại.";
  if (/exceeds balance|transfer amount exceeds/i.test(text)) return "Ví không đủ số dư cho khoản này.";
  return text || "Ví không gửi được giao dịch.";
}

export function useTx() {
  const [phase, setPhase] = useState<TxPhase>({ step: "idle" });
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const client = usePublicClient({ chainId: avalancheFuji.id });
  const queryClient = useQueryClient();

  async function run(send: () => Promise<Hex>): Promise<TransactionReceipt | null> {
    if (phase.step === "unknown") return null;
    setPhase({ step: "wallet" });
    let hash: Hex;
    try {
      if (chainId !== avalancheFuji.id) await switchChainAsync({ chainId: avalancheFuji.id });
      hash = await send();
    } catch (e) {
      setPhase({ step: "failed", message: walletErrorText(e) });
      return null;
    }
    return checkReceipt(hash);
  }

  async function checkReceipt(hash: Hex): Promise<TransactionReceipt | null> {
    setPhase({ step: "mining", hash });
    try {
      if (!client) throw new Error("no client");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setPhase({ step: "failed", hash, message: "Giao dịch bị từ chối trên chain. Chưa có gì thay đổi." });
        return null;
      }
      setPhase({ step: "done", hash, receipt });
      await queryClient.invalidateQueries();
      return receipt;
    } catch {
      setPhase({ step: "unknown", hash });
      return null;
    }
  }

  return {
    phase,
    run,
    checkStatus: () => (phase.step === "unknown" ? checkReceipt(phase.hash) : Promise.resolve(null)),
    busy: phase.step === "wallet" || phase.step === "mining",
    reset: () => setPhase({ step: "idle" }),
  };
}
