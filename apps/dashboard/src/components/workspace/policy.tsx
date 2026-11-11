"use client";
// Owner changes prepared by the server (applying a rule set to an agent, or an older single change): the owner's
// wallet signs exactly the prepared call, then the server verifies the transaction on chain. Nothing changes on
// the vault until the wallet signs.
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, useChainId, useSendTransaction, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { AccountApiError } from "@/lib/account";
import { knownName, NETWORK, tokenMeta } from "@/lib/config";
import { formatTime, shortHex } from "@/lib/format";
import { MAX_RISK_LABEL, RISK_BY_CODE } from "@/lib/labels";
import {
  POLICY_KIND_LABEL,
  POLICY_STATUS_LABEL,
  useInvalidate,
  usePolicyChanges,
  wsApi,
  type PolicyChange,
} from "@/lib/workspace";
import { errorOf } from "@/components/form";
import { useConfirm } from "@/components/fields";
import { AddressLink, Card, TechDetails, TxLink } from "@/components/ui";

const units = (raw: unknown, token: string) => {
  const m = tokenMeta(token);
  return `${formatUnits(BigInt(String(raw)), m.decimals)} ${m.symbol}`;
};
const avax = (raw: unknown) => `${formatUnits(BigInt(String(raw)), 18)} AVAX`;

/** What the change does, in one line. */
function describe(c: PolicyChange): ReactNode {
  const p = c.params;
  switch (c.kind) {
    case "pause":
      return "Khoá két: agent không chi được gì.";
    case "unpause":
      return "Mở khoá két cho agent.";
    case "revoke_agent":
      return "Gỡ quyền agent: không còn ví nào chi tiêu thay chủ két.";
    case "set_agent":
      return (
        <>
          Đặt agent: <AddressLink address={String(p.agent)} />
        </>
      );
    case "allow_recipient":
      return (
        <>
          {p.allowed ? "Thêm người nhận tin cậy" : "Gỡ người nhận tin cậy"}:{" "}
          <AddressLink address={String(p.address)} />
        </>
      );
    case "allow_target":
      return (
        <>
          {p.allowed ? "Cho phép dùng ứng dụng" : "Gỡ ứng dụng"}: <AddressLink address={String(p.address)} />
        </>
      );
    case "allow_selector":
      return (
        <>
          {p.allowed ? "Cho phép" : "Gỡ"} một thao tác trên{" "}
          {knownName(String(p.target)) ?? shortHex(String(p.target))}
        </>
      );
    case "token_policy": {
      const t = String(p.token);
      const sym = tokenMeta(t).symbol;
      return p.tracked
        ? `${sym}: tiêu tối đa ${units(p.dailyCap, t)} mỗi ngày, cần Guardian duyệt từ ${units(p.verdictThreshold, t)}, quyền rút tối đa ${units(p.maxApproval, t)}.`
        : `Bỏ hạn mức ${sym}: két không còn giới hạn chi ${sym}.`;
    }
    case "native_policy":
      return `AVAX: tiêu tối đa ${avax(p.dailyCap)} mỗi ngày, cần Guardian duyệt từ ${avax(p.verdictThreshold)}.`;
    case "max_agent_risk":
      return MAX_RISK_LABEL[RISK_BY_CODE[Number(p.risk)] ?? "LOW"];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A submitted change is re-verified on chain every few seconds until it is mined. */
export function useSubmittedPolling(vault: string, changes: PolicyChange[] | undefined) {
  const invalidate = useInvalidate(vault);
  const pendingIds = (changes ?? [])
    .filter((c) => c.status === "submitted")
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const t = setInterval(() => {
      void Promise.all(
        pendingIds.split(",").map((id) => wsApi(vault, `policy-changes/${id}`).catch(() => null)),
      ).then(() => invalidate("policy", "assignments"));
    }, 4000);
    return () => clearInterval(t);
  }, [pendingIds, vault, invalidate]);
}

const STATUS_COLOR: Record<PolicyChange["status"], "success" | "danger" | "default" | "warning"> = {
  confirmed: "success",
  failed: "danger",
  cancelled: "default",
  draft: "warning",
  submitted: "warning",
};

export function ChangeItem({
  vault,
  change,
  ownerWallet,
  onChanged,
  step,
}: {
  vault: string;
  change: PolicyChange;
  ownerWallet: Address;
  onChanged: () => void;
  /** "Bước 2/5" when the change is one of an ordered set. */
  step?: string;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const confirm = useConfirm();
  const wrongWallet = isConnected && address?.toLowerCase() !== ownerWallet.toLowerCase();

  const sign = useMutation({
    mutationFn: async () => {
      if (NETWORK === "local") throw new Error("Bản demo chạy trên fork nên không ký được giao dịch ví.");
      if (!isConnected) throw new Error("Hãy kết nối ví chủ két trước.");
      if (chainId !== avalancheFuji.id) await switchChainAsync({ chainId: avalancheFuji.id });
      const hash = await sendTransactionAsync({
        to: change.transaction.to,
        data: change.transaction.data,
        value: 0n,
        chainId: avalancheFuji.id,
      });
      // The node may not know the transaction for a few seconds: retry while it is "not found".
      for (let i = 0; ; i++) {
        try {
          return await wsApi(vault, `policy-changes/${change.id}/submit`, "POST", { txHash: hash });
        } catch (e) {
          if (!(e instanceof AccountApiError && e.code === "tx_not_found") || i >= 9) throw e;
          await sleep(2000);
        }
      }
    },
    onSuccess: () => toast("Đã gửi giao dịch", { description: "Đang chờ xác nhận trên chain." }),
    onError: (e) => toast.danger("Chưa ký được", { description: errorOf(e) }),
    onSettled: onChanged,
  });

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-4">
      <div className="flex flex-wrap items-center gap-2">
        {step ? <span className="text-xs font-medium text-muted tabular-nums">{step}</span> : null}
        <span className="font-medium">{POLICY_KIND_LABEL[change.kind]}</span>
        <Chip size="sm" variant="soft" color={STATUS_COLOR[change.status]}>
          {POLICY_STATUS_LABEL[change.status]}
        </Chip>
        <span className="text-xs text-muted tabular-nums">{formatTime(change.createdAt)}</span>
      </div>
      <p className="text-sm">{describe(change)}</p>
      {change.note ? <p className="text-sm text-muted">Ghi chú: {change.note}</p> : null}
      {change.txHash ? (
        <p className="text-sm">
          <TxLink hash={change.txHash} label="Xem giao dịch" />
        </p>
      ) : null}
      {change.status === "draft" ? (
        <>
          {wrongWallet ? (
            <p role="alert" className="text-sm text-warning-soft-foreground">
              Ví đang kết nối ({shortHex(address ?? "")}) không phải chủ két ({shortHex(ownerWallet)}): két sẽ
              từ chối giao dịch.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              isDisabled={NETWORK === "local" || !isConnected || wrongWallet}
              isPending={sign.isPending}
              onPress={() => sign.mutate()}
            >
              {sign.isPending ? "Đang chờ ví…" : "Ký trong ví"}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              onPress={() =>
                confirm.ask({
                  title: "Huỷ thay đổi này?",
                  body: "Bản nháp bị bỏ; két không đổi gì.",
                  confirmLabel: "Huỷ thay đổi",
                  onConfirm: async () => {
                    await wsApi(vault, `policy-changes/${change.id}`, "DELETE");
                    onChanged();
                    toast("Đã huỷ thay đổi");
                  },
                })
              }
            >
              Huỷ
            </Button>
            {NETWORK === "local" ? (
              <span className="text-xs text-muted">Bản demo trên fork không ký được giao dịch ví.</span>
            ) : !isConnected ? (
              <span className="text-xs text-muted">Kết nối ví chủ két ở thanh trên để ký.</span>
            ) : null}
          </div>
          <TechDetails label="Giao dịch ví sẽ ký">
            <p className="font-mono break-all">to: {change.transaction.to}</p>
            <p className="font-mono break-all">data: {change.transaction.data}</p>
            <p className="font-mono">value: 0</p>
          </TechDetails>
        </>
      ) : null}
      {confirm.dialog}
    </li>
  );
}

/** Single owner changes still waiting for the wallet (not part of a rule set being applied). */
export function PendingChanges({ vault, ownerWallet }: { vault: string; ownerWallet: Address }) {
  const q = usePolicyChanges(vault);
  const invalidate = useInvalidate(vault);
  useSubmittedPolling(vault, q.data?.changes);
  const pending = (q.data?.changes ?? []).filter(
    (c) => (c.status === "draft" || c.status === "submitted") && c.assignmentId === null,
  );
  if (!pending.length) return null;
  return (
    <Card title="Chờ ký" description={`${pending.length} thay đổi đang chờ ví chủ két`}>
      <ul className="flex flex-col gap-3">
        {pending.map((c) => (
          <ChangeItem
            key={c.id}
            vault={vault}
            change={c}
            ownerWallet={ownerWallet}
            onChanged={() => invalidate("policy", "assignments")}
          />
        ))}
      </ul>
    </Card>
  );
}
