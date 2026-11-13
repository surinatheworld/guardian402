"use client";
// Every owner transaction goes through one flow: review what changes (before → after, in words) → sign in the
// wallet → sent → confirmed on chain, with each step visible, a toast at the end and a retry on failure.
import { CircleCheckFill, CircleXmarkFill } from "@gravity-ui/icons";
import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Modal } from "@heroui/react/modal";
import { Spinner } from "@heroui/react/spinner";
import { toast } from "@heroui/react/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useChainId, usePublicClient, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { TechDetails, TxLink } from "./ui";

export type Change = { label: string; before: ReactNode; after: ReactNode };

export type OwnerAction = {
  title: string;
  /** What happens, in one or two plain sentences. */
  summary: ReactNode;
  changes?: Change[];
  /** The contract call, shown only in the technical details. */
  call: string;
  confirmLabel: string;
  successTitle: string;
  danger?: boolean;
  send: () => Promise<Hex>;
};

type Phase =
  | { step: "review" }
  | { step: "wallet" }
  | { step: "mining"; hash: Hex }
  | { step: "unknown"; hash: Hex }
  | { step: "failed"; message: string; hash?: Hex };

const STEPS = ["Ký trong ví", "Gửi lên mạng", "Xác nhận trên chain"] as const;

const walletError = (e: unknown) => {
  const text = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
  if (/user rejected|denied|rejected the request/i.test(text))
    return "Bạn đã từ chối trong ví. Chưa có gì thay đổi.";
  return text || "Ví không gửi được giao dịch.";
};

/** `request(action)` opens the review dialog; render `dialog` once in the page. */
export function useOwnerAction() {
  const [action, setAction] = useState<OwnerAction | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "review" });
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const client = usePublicClient({ chainId: avalancheFuji.id });
  const queryClient = useQueryClient();

  const busy = phase.step === "wallet" || phase.step === "mining";

  async function run(a: OwnerAction) {
    setPhase({ step: "wallet" });
    let hash: Hex;
    try {
      if (chainId !== avalancheFuji.id) await switchChainAsync({ chainId: avalancheFuji.id });
      hash = await a.send();
    } catch (e) {
      setPhase({ step: "failed", message: walletError(e) });
      return;
    }
    await checkReceipt(a, hash);
  }

  async function checkReceipt(a: OwnerAction, hash: Hex) {
    setPhase({ step: "mining", hash });
    try {
      if (!client) throw new Error("no client");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setPhase({ step: "failed", hash, message: "Két từ chối giao dịch trên chain. Chưa có gì thay đổi." });
        return;
      }
    } catch {
      setPhase({ step: "unknown", hash });
      return;
    }
    await queryClient.invalidateQueries();
    toast.success(a.successTitle, { description: <TxLink hash={hash} label="Xem giao dịch" /> });
    setAction(null);
    setPhase({ step: "review" });
  }

  const current = phase.step === "wallet" ? 0 : phase.step === "mining" ? 2 : -1;

  const dialog = (
    <Modal.Backdrop
      isOpen={action !== null}
      isDismissable={!busy && phase.step !== "unknown"}
      onOpenChange={(open) => {
        if (!open && !busy && phase.step !== "unknown") {
          setAction(null);
          setPhase({ step: "review" });
        }
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          {action ? (
            <>
              {phase.step !== "unknown" ? <Modal.CloseTrigger /> : null}
              <Modal.Header>
                <Modal.Heading className="text-lg font-semibold">{action.title}</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <div className="text-base">{action.summary}</div>
                {action.changes?.length ? (
                  <dl className="grid grid-cols-[minmax(7rem,auto)_1fr_1fr] gap-x-4 gap-y-2 rounded-xl bg-surface-secondary p-3 text-sm">
                    <dt className="sr-only">Mục</dt>
                    <dd className="text-xs font-medium text-muted">Mục</dd>
                    <dd className="text-xs font-medium text-muted">Hiện tại</dd>
                    <dd className="text-xs font-medium text-muted">Sau khi ký</dd>
                    {action.changes.map((c) => (
                      <div key={c.label} className="contents">
                        <dt className="font-medium">{c.label}</dt>
                        <dd className="min-w-0 break-words text-muted tabular-nums">{c.before}</dd>
                        <dd className="min-w-0 break-words font-semibold tabular-nums">{c.after}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {phase.step !== "review" ? (
                  <ol aria-label="Tiến trình" className="flex flex-col gap-2 text-sm" aria-live="polite">
                    {STEPS.map((label, i) => {
                      const failed =
                        (phase.step === "failed" && i === (phase.hash ? 2 : 0)) ||
                        (phase.step === "unknown" && i === 2);
                      const done =
                        phase.step === "mining"
                          ? i < 2
                          : (phase.step === "failed" && phase.hash) || phase.step === "unknown"
                            ? i < 2
                            : false;
                      const active = i === current || (phase.step === "mining" && i === 1);
                      return (
                        <li key={label} className="flex items-center gap-2">
                          {failed ? (
                            <CircleXmarkFill aria-hidden="true" className="size-4 text-danger" />
                          ) : done ? (
                            <CircleCheckFill aria-hidden="true" className="size-4 text-success" />
                          ) : active ? (
                            <Spinner size="sm" color="current" />
                          ) : (
                            <span aria-hidden="true" className="size-4 rounded-full border border-border" />
                          )}
                          <span className={done || active || failed ? "" : "text-muted"}>{label}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
                {phase.step === "unknown" ? (
                  <Alert status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Đã gửi, chưa xác định kết quả</Alert.Title>
                      <Alert.Description>
                        Kiểm tra lại trạng thái trước khi gửi giao dịch khác.{" "}
                        <TxLink hash={phase.hash} label="Xem giao dịch" />
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {phase.step === "failed" ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Chưa thực hiện được</Alert.Title>
                      <Alert.Description>
                        {phase.message}
                        {phase.hash ? (
                          <>
                            {" "}
                            <TxLink hash={phase.hash} label="Giao dịch" />
                          </>
                        ) : null}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                <TechDetails>
                  <code className="font-mono break-all">{action.call}</code>
                </TechDetails>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary" isDisabled={busy || phase.step === "unknown"}>
                  Huỷ
                </Button>
                <Button
                  variant={action.danger ? "danger" : "primary"}
                  isPending={busy}
                  onPress={() =>
                    void (phase.step === "unknown" ? checkReceipt(action, phase.hash) : run(action))
                  }
                >
                  {phase.step === "wallet"
                    ? "Đang chờ ví…"
                    : phase.step === "mining"
                      ? "Đang xác nhận…"
                      : phase.step === "unknown"
                        ? "Kiểm tra trạng thái"
                        : phase.step === "failed"
                          ? "Thử lại"
                          : action.confirmLabel}
                </Button>
              </Modal.Footer>
            </>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );

  return {
    request: (a: OwnerAction) => {
      setPhase({ step: "review" });
      setAction(a);
    },
    dialog,
  };
}
