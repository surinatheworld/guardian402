"use client";
// The Guardian's track record on the official ERC-8004 ReputationRegistry (Fuji): owners who reviewed a check
// write "right" (100) or "false alarm" (0) on chain, tagged "tx-risk", with the checkId as the feedback hash.
// The Guardian's own key cannot write feedback (the registry refuses self-feedback), so the score comes only
// from owners. Reading needs no wallet; writing is an owner transaction like any other.
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import type { Address, Hex } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import {
  agentVaultAbi,
  ERC8004_FUJI,
  getErc8004Record,
  guardianFeedbackArgs,
  REPUTATION_TAG,
  reputationRegistryAbi,
  reputationScore,
  type FeedbackKind,
} from "@guardian402/shared";
import { GUARDIAN_URL } from "@/lib/config";
import { formatCount } from "@/lib/format";
import { useOwnerAction } from "./owner-action";
import { AddressLink, Facts, LoadingRows, Stat } from "./ui";
import { useOwnerGate } from "./wallet";

const record = getErc8004Record();

/** The Guardian's agent id, or undefined before `pnpm erc8004:fuji` has run. */
export const GUARDIAN_AGENT_ID = record?.agentId;

function useReputation() {
  const agentId = GUARDIAN_AGENT_ID === undefined ? undefined : BigInt(GUARDIAN_AGENT_ID);
  const clients = useReadContract({
    address: ERC8004_FUJI.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "getClients",
    args: agentId === undefined ? undefined : [agentId],
    chainId: avalancheFuji.id,
    query: { enabled: agentId !== undefined, refetchInterval: 30_000 },
  });
  const list = clients.data ?? [];
  const summary = useReadContract({
    address: ERC8004_FUJI.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "getSummary",
    args: agentId === undefined ? undefined : [agentId, list, REPUTATION_TAG, ""],
    chainId: avalancheFuji.id,
    query: { enabled: agentId !== undefined && list.length > 0, refetchInterval: 30_000 },
  });
  const [count, value, decimals] = summary.data ?? [0n, 0n, 0];
  return {
    loading: clients.isPending || (list.length > 0 && summary.isPending),
    error: clients.isError || summary.isError,
    owners: list.length,
    count,
    score: reputationScore(count, value, decimals),
  };
}

/** For Về Guardian: the on-chain identity and the score owners gave it. */
export function GuardianReputation() {
  const r = useReputation();
  if (GUARDIAN_AGENT_ID === undefined || !record) return null;
  return (
    <div className="flex flex-col gap-4">
      {r.loading ? (
        <LoadingRows rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Stat
            label="Chủ két đánh giá đúng"
            value={r.score === null ? "—" : `${Math.round(r.score)}%`}
            hint={r.score === null ? "Chưa có đánh giá nào" : undefined}
          />
          <Stat label="Lượt đánh giá" value={formatCount(Number(r.count))} />
          <Stat label="Số ví chủ két" value={formatCount(r.owners)} />
        </div>
      )}
      {r.error ? <p className="text-sm text-danger">Không đọc được ReputationRegistry trên chain.</p> : null}
      <Facts
        rows={[
          ["Danh tính", `Agent #${GUARDIAN_AGENT_ID} trên IdentityRegistry chính thức của ERC-8004`],
          ["IdentityRegistry", <AddressLink key="i" address={record.identityRegistry} />],
          ["ReputationRegistry", <AddressLink key="r" address={ERC8004_FUJI.reputationRegistry} />],
        ]}
      />
      <p className="text-sm text-muted">
        Điểm do chính các chủ két ghi lên chain sau khi xem lại một lần Guardian chấm (ở trang Hoạt động).
        Khoá của Guardian không tự chấm được cho mình: registry từ chối.
      </p>
    </div>
  );
}

const KIND: Record<string, FeedbackKind | undefined> = {
  reviewed: "correct",
  false_positive: "false-positive",
};

/** For a reviewed check: write the owner's verdict on the Guardian to the ReputationRegistry. */
export function OnChainFeedback({
  vault,
  checkId,
  status,
}: {
  vault: Address;
  checkId: Hex;
  status: string;
}) {
  const owner = useReadContract({ address: vault, abi: agentVaultAbi, functionName: "owner" });
  const gate = useOwnerGate(owner.data);
  const action = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const kind = KIND[status];
  if (GUARDIAN_AGENT_ID === undefined) return null;
  const agentId = GUARDIAN_AGENT_ID;
  const endpoint = GUARDIAN_URL.startsWith("/") ? `${window.location.origin}${GUARDIAN_URL}` : GUARDIAN_URL;
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="sm"
        variant="tertiary"
        className="self-start"
        isDisabled={!gate.ok || !kind}
        onPress={() =>
          kind &&
          action.request({
            title: "Ghi đánh giá Guardian lên chain",
            summary:
              kind === "correct"
                ? "Ghi lên ERC-8004 rằng Guardian chấm đúng lần kiểm tra này. Ai cũng xem được điểm uy tín của Guardian."
                : "Ghi lên ERC-8004 rằng lần kiểm tra này là báo động nhầm. Điểm uy tín của Guardian sẽ giảm.",
            call: `ReputationRegistry.giveFeedback(${agentId}, ${kind === "correct" ? 100 : 0}, 0, "${REPUTATION_TAG}", "${kind}", …, checkId)`,
            confirmLabel: "Ký và ghi",
            successTitle: "Đã ghi đánh giá lên chain",
            send: () =>
              writeContractAsync({
                address: ERC8004_FUJI.reputationRegistry,
                abi: reputationRegistryAbi,
                functionName: "giveFeedback",
                args: guardianFeedbackArgs(agentId, checkId, kind, endpoint),
                chainId: avalancheFuji.id,
              }),
          })
        }
      >
        Ghi đánh giá lên ERC-8004
      </Button>
      <Description className="text-xs text-muted">
        {!kind
          ? "Chọn “Đã xem” (Guardian chấm đúng) hoặc “Báo động nhầm” để ghi lên chain."
          : gate.ok
            ? "Tuỳ chọn: ví chủ ký một giao dịch, cộng vào điểm uy tín công khai của Guardian."
            : gate.message}
      </Description>
      {action.dialog}
    </div>
  );
}
