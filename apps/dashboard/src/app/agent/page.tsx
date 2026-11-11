"use client";
// Agent: which agent spends from this vault, and the agents you connect (rule set, API keys, pause). Removing
// the agent's right to spend is an owner transaction; pausing its API keys only affects the Guardian.
import { Plus } from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import NextLink from "next/link";
import { useState } from "react";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Card, Empty, PageHeader } from "@/components/ui";
import { OwnerGateNotice, useOwnerGate } from "@/components/wallet";
import { AgentsList } from "@/components/workspace/agents";
import { useMe } from "@/lib/account";
import { ZERO_ADDRESS } from "@/lib/format";
import { PAGE } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";

export default function AgentPage() {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const me = useMe();
  const linked = me.data?.vaults.find((v) => v.address.toLowerCase() === vault.toLowerCase());
  const [adding, setAdding] = useState(false);
  const hasAgent = p && p.agent !== ZERO_ADDRESS;

  return (
    <>
      <PageHeader
        title={PAGE.agents}
        actions={
          linked ? (
            <Button variant="primary" onPress={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Thêm agent
            </Button>
          ) : null
        }
      />
      <OwnerGateNotice gate={gate} />

      <Card
        title="Agent đang chi tiêu từ két"
        actions={
          hasAgent ? (
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={!gate.ok}
              onPress={() =>
                owner.request({
                  title: "Gỡ quyền agent",
                  summary: (
                    <>
                      <AddressLink address={p.agent} /> không chi được gì từ két nữa, kể cả khi không qua
                      Guardian. Muốn dùng lại phải đặt agent mới.
                    </>
                  ),
                  changes: [{ label: "Agent", before: <AddressLink address={p.agent} />, after: "Không có" }],
                  call: `AgentVault.setAgent(${ZERO_ADDRESS})`,
                  confirmLabel: "Ký và gỡ quyền",
                  successTitle: "Đã gỡ quyền agent",
                  danger: true,
                  send: () =>
                    writeContractAsync({
                      address: vault,
                      abi: agentVaultAbi,
                      functionName: "setAgent",
                      args: [ZERO_ADDRESS],
                      chainId: avalancheFuji.id,
                    }),
                })
              }
            >
              Gỡ quyền agent
            </Button>
          ) : null
        }
      >
        {p ? (
          hasAgent ? (
            <AddressLink address={p.agent} />
          ) : (
            <p className="text-sm text-muted">
              Két chưa có agent. Chọn “Cho chi tiêu từ két” ở một agent bên dưới.
            </p>
          )
        ) : (
          <p className="text-sm text-muted">Đang đọc két…</p>
        )}
      </Card>

      {linked ? (
        <AgentsList vault={linked.address} gate={gate} owner={owner} adding={adding} setAdding={setAdding} />
      ) : (
        <Card title="Agent của bạn">
          <Empty
            action={
              <NextLink href="/tai-khoan" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {me.data ? "Liên kết két này" : "Đăng nhập"}
              </NextLink>
            }
          >
            {me.data
              ? "Liên kết két này với tài khoản để thêm agent, gán bộ quy tắc và cấp khoá API."
              : "Đăng nhập bằng ví chủ két để thêm agent, gán bộ quy tắc và cấp khoá API."}
          </Empty>
        </Card>
      )}
      {owner.dialog}
    </>
  );
}
