"use client";
// The state of one wallet transaction, in place, under the button that started it.
import { CircleCheckFill, CircleXmarkFill } from "@gravity-ui/icons";
import { Spinner } from "@heroui/react/spinner";
import type { ReactNode } from "react";
import type { TxPhase } from "@/lib/tx";
import { TxLink } from "./ui";

export function TxStatus({ phase, done }: { phase: TxPhase; done: ReactNode }) {
  if (phase.step === "idle") return null;
  return (
    <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {phase.step === "wallet" ? (
        <>
          <Spinner size="sm" color="current" />
          <span>Mở ví và ký giao dịch…</span>
        </>
      ) : phase.step === "mining" ? (
        <>
          <Spinner size="sm" color="current" />
          <span>Đã gửi, đang chờ mạng xác nhận (vài giây)…</span>
          <TxLink hash={phase.hash} label="Xem" />
        </>
      ) : phase.step === "done" ? (
        <>
          <CircleCheckFill aria-hidden="true" className="size-4 text-success" />
          <span className="font-medium">{done}</span>
          <TxLink hash={phase.hash} label="Xem giao dịch" />
        </>
      ) : (
        <>
          <CircleXmarkFill aria-hidden="true" className="size-4 text-danger" />
          <span className="text-danger">{phase.message}</span>
          {phase.hash ? <TxLink hash={phase.hash} label="Giao dịch" /> : null}
        </>
      )}
    </p>
  );
}
