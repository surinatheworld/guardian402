"use client";
// Tổng quan: the vault at a glance. The vault and its state, the money actions (deposit, withdraw, agent fees),
// what is left to set up, then three figures — balance, today against the daily cap, the total budget — and
// the latest activity next to the agent. The full feed lives on Hoạt động; the rules on Quy tắc.
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRotateLeft,
  ArrowUpFromLine,
  CircleCheckFill,
  CircleDashed,
  Cpu,
  Thunderbolt,
  Lock,
  ShieldCheck,
  Sliders,
} from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { Meter } from "@heroui/react/meter";
import { Modal } from "@heroui/react/modal";
import { NumberField } from "@heroui/react/number-field";
import { Skeleton } from "@heroui/react/skeleton";
import NextLink from "next/link";
import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { ActivityDrawer, ActivityRows, ActivityState } from "@/components/activity-view";
import { EditModal } from "@/components/edit-modal";
import { AgentFeeForm, DepositForm } from "@/components/fund";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, ErrorBox } from "@/components/ui";
import { useOwnerGate } from "@/components/wallet";
import type { ActivityItem } from "@/lib/activity";
import { useActivity } from "@/lib/activity-hooks";
import { AGENT_FEE_AVAX, AGENT_FEE_USDC, useBalances } from "@/lib/balances";
import { deployment } from "@/lib/config";
import { formatAmount, fromUnits, toUnits, ZERO_ADDRESS } from "@/lib/format";
import { useMe } from "@/lib/account";
import { useVaultLimits, useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import { useAgentKeys, useAgents } from "@/lib/workspace";

type Policy = NonNullable<ReturnType<typeof useVaultPolicy>["data"]>;
const isUsdc = (t: { token: string }) => t.token.toLowerCase() === deployment.usdc.toLowerCase();
const usdc = (raw: bigint, digits = 2) => formatAmount(raw, 6, digits);
const pct = (part: bigint, whole: bigint) =>
  whole > 0n ? Number(((part > whole ? whole : part) * 1000n) / whole) / 10 : 0;

export default function Overview() {
  const { address: vault, viewingDemo } = useSelectedVault();
  const me = useMe();
  const policy = useVaultPolicy();
  const limits = useVaultLimits();
  const p = policy.data;
  const [modal, setModal] = useState<"deposit" | "fee" | null>(null);
  const label = viewingDemo
    ? "Két demo"
    : (me.data?.vaults.find((v) => v.address.toLowerCase() === vault.toLowerCase())?.label ?? "Két của tôi");
  const agent = p && p.agent !== ZERO_ADDRESS ? p.agent : undefined;

  return (
    <>
      <header className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-title">{label}</h1>
          {p ? (
            p.paused ? (
              <Chip color="danger" variant="soft">
                <Lock aria-hidden="true" className="size-3.5" />
                <Chip.Label>Đã khoá</Chip.Label>
              </Chip>
            ) : (
              <Chip color="success" variant="soft">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                <Chip.Label>Đang bảo vệ</Chip.Label>
              </Chip>
            )
          ) : null}
          <span className="text-sm text-muted">
            <AddressLink address={vault} name="" />
          </span>
        </div>
        {viewingDemo ? null : (
          <QuickActions p={p} vault={vault} onModal={setModal} hasAgent={Boolean(agent)} />
        )}
      </header>

      {!viewingDemo && p ? <Setup vault={vault} p={p} onModal={setModal} /> : null}

      {policy.isError ? (
        <ErrorBox
          title="Không đọc được két trên chain"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : (
        <section aria-label="Số liệu của két" className="grid gap-4 md:grid-cols-3">
          <BalanceCard p={p} />
          <TodayCard p={p} limits={limits.data} />
          <BudgetCard vault={vault} p={p} limits={limits.data} unsupported={limits.unsupported} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <RecentActivity />
        <AgentCard vault={vault} agent={agent} viewingDemo={viewingDemo} onFee={() => setModal("fee")} />
      </div>

      <MoneyModal
        open={modal === "deposit"}
        onClose={() => setModal(null)}
        title="Nạp tiền vào két"
        lead="Chuyển USDC từ ví của bạn vào két. Agent chỉ tiêu được tiền trong két, theo quy tắc của két."
      >
        <DepositForm vault={vault} />
      </MoneyModal>
      {agent ? (
        <MoneyModal
          open={modal === "fee"}
          onClose={() => setModal(null)}
          title="Gửi phí cho agent"
          lead="Agent tự trả phí mạng (AVAX) và phí Guardian (USDC) từ ví riêng của nó, không lấy từ két."
        >
          <AgentFeeForm agent={agent} />
        </MoneyModal>
      ) : null}
    </>
  );
}

function MoneyModal({
  open,
  onClose,
  title,
  lead,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header className="flex flex-col gap-1">
            <Modal.Heading className="text-heading">{title}</Modal.Heading>
            <p className="text-sm text-muted">{lead}</p>
          </Modal.Header>
          <Modal.Body className="pb-2">{children}</Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              Đóng
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

// ------------------------------------------------------------------ actions

function QuickActions({
  p,
  vault,
  hasAgent,
  onModal,
}: {
  p: Policy | undefined;
  vault: Address;
  hasAgent: boolean;
  onModal: (m: "deposit" | "fee") => void;
}) {
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const [withdrawing, setWithdrawing] = useState(false);
  const [amount, setAmount] = useState(0);
  const balance = p?.tokens.find(isUsdc)?.balance ?? 0n;
  const tooMuch = toUnits(amount, 6) > balance;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onPress={() => onModal("deposit")}>
        <ArrowDownToLine aria-hidden="true" />
        Nạp tiền
      </Button>
      <Button
        variant="secondary"
        isDisabled={!gate.ok || balance === 0n}
        onPress={() => {
          setAmount(fromUnits(balance, 6));
          setWithdrawing(true);
        }}
      >
        <ArrowUpFromLine aria-hidden="true" />
        Rút tiền
      </Button>
      {hasAgent ? (
        <Button variant="secondary" onPress={() => onModal("fee")}>
          <Thunderbolt aria-hidden="true" />
          Gửi phí cho agent
        </Button>
      ) : null}
      <NextLink href="/quy-tac" className={buttonVariants({ variant: "secondary" })}>
        <Sliders aria-hidden="true" />
        Sửa quy tắc
      </NextLink>
      {!gate.ok && gate.reason === "wrong-wallet" ? (
        <span className="text-sm text-muted">{gate.message}</span>
      ) : null}
      <EditModal
        isOpen={withdrawing}
        onOpenChange={setWithdrawing}
        title="Rút USDC về ví của bạn"
        isSubmitDisabled={amount <= 0 || tooMuch}
        onSubmit={() => {
          setWithdrawing(false);
          if (!p) return;
          const raw = toUnits(amount, 6);
          owner.request({
            title: "Rút USDC về ví của bạn",
            summary: (
              <>
                Chuyển {usdc(raw, 6)} USDC từ két về ví chủ <AddressLink address={p.owner} />. Rút được cả khi
                két đang khoá.
              </>
            ),
            changes: [
              {
                label: "Số dư két",
                before: `${usdc(balance, 6)} USDC`,
                after: `${usdc(balance - raw, 6)} USDC`,
              },
            ],
            call: `AgentVault.withdraw(USDC, ${p.owner}, ${raw})`,
            confirmLabel: "Ký và rút",
            successTitle: "Đã rút về ví của bạn",
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "withdraw",
                args: [deployment.usdc, p.owner, raw],
                chainId: avalancheFuji.id,
              }),
          });
        }}
      >
        <NumberField
          value={amount}
          onChange={setAmount}
          minValue={0}
          maxValue={fromUnits(balance, 6)}
          step={1}
          formatOptions={{ maximumFractionDigits: 6 }}
          isInvalid={tooMuch}
          autoFocus
        >
          <Label>Số USDC</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description>Trong két có {usdc(balance, 6)} USDC.</Description>
        </NumberField>
      </EditModal>
      {owner.dialog}
    </div>
  );
}

// ------------------------------------------------------------------ setup checklist

function Setup({
  vault,
  p,
  onModal,
}: {
  vault: Address;
  p: Policy;
  onModal: (m: "deposit" | "fee") => void;
}) {
  const agents = useAgents(vault);
  const agent = agents.data?.agents.find((a) => a.isOnChainAgent);
  const keys = useAgentKeys(vault, agent?.id ?? 0);
  const agentBalances = useBalances(p.agent !== ZERO_ADDRESS ? p.agent : undefined);
  const funded = (p.tokens.find(isUsdc)?.balance ?? 0n) > 0n;
  const fees =
    agentBalances.avax !== undefined &&
    agentBalances.usdc !== undefined &&
    agentBalances.avax >= AGENT_FEE_AVAX / 2n &&
    agentBalances.usdc >= AGENT_FEE_USDC / 2n;
  const connected = (keys.data?.keys ?? []).some((k) => k.lastUsedAt !== null);
  if (agents.isPending || (agent && keys.isPending) || agentBalances.isPending) return null;
  const steps: { done: boolean; title: string; text: string; action: ReactNode }[] = [
    {
      done: funded,
      title: "Nạp tiền vào két",
      text: "Agent chỉ tiêu được tiền trong két.",
      action: (
        <Button size="sm" variant="primary" onPress={() => onModal("deposit")}>
          Nạp tiền
        </Button>
      ),
    },
    {
      done: fees,
      title: "Gửi phí cho agent",
      text: "AVAX trả phí mạng và USDC trả phí Guardian, vào ví riêng của agent.",
      action: (
        <Button size="sm" variant="primary" onPress={() => onModal("fee")}>
          Gửi phí
        </Button>
      ),
    },
    {
      done: connected,
      title: "Kết nối agent",
      text: "Gắn khoá API và MCP vào agent. Xong khi agent gọi Guardian lần đầu.",
      action: (
        <NextLink href="/agent" className={buttonVariants({ size: "sm", variant: "primary" })}>
          Mở hướng dẫn
        </NextLink>
      ),
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  const nextIndex = steps.findIndex((s) => !s.done);
  return (
    <Card className="p-2">
      <Card.Header className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <Card.Title className="text-heading">Còn {left} bước để agent chi tiêu được</Card.Title>
        <span className="text-sm text-muted tabular-nums">
          {steps.length - left}/{steps.length} xong
        </span>
      </Card.Header>
      <Card.Content>
        <ol className="flex flex-col divide-y divide-separator">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-1 last:pb-1"
            >
              {s.done ? (
                <CircleCheckFill aria-hidden="true" className="size-5 shrink-0 text-success" />
              ) : (
                <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-muted" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={`text-sm font-medium ${s.done ? "text-muted line-through" : ""}`}>
                  {s.title}
                </span>
                {s.done ? null : <span className="text-sm text-muted">{s.text}</span>}
              </div>
              {!s.done && i === nextIndex ? s.action : null}
            </li>
          ))}
        </ol>
      </Card.Content>
    </Card>
  );
}

// ------------------------------------------------------------------ figures

function Figure({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <Card className="min-w-0 p-2">
      <Card.Header>
        <Card.Description className="text-sm font-medium">{label}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">{children}</Card.Content>
      {foot ? <Card.Footer className="text-sm text-muted">{foot}</Card.Footer> : null}
    </Card>
  );
}

const Amount = ({ value, unit = "USDC" }: { value: string; unit?: string }) => (
  <p className="text-display tabular-nums wrap-anywhere">
    {value}
    <span className="ml-1.5 text-base font-medium tracking-normal text-muted">{unit}</span>
  </p>
);

function BalanceCard({ p }: { p: Policy | undefined }) {
  const t = p?.tokens.find(isUsdc);
  return (
    <Figure label="Số dư trong két" foot={p ? "Chỉ bạn rút được, kể cả khi két đang khoá." : null}>
      {!p ? <Skeleton className="h-11 w-40 rounded-lg" /> : <Amount value={t ? usdc(t.balance) : "0"} />}
    </Figure>
  );
}

type Limits = ReturnType<typeof useVaultLimits>["data"];
const limitsOf = (l: Limits) => l?.find((x) => x.token.toLowerCase() === deployment.usdc.toLowerCase());

function TodayCard({ p, limits }: { p: Policy | undefined; limits: Limits }) {
  const t = p?.tokens.find(isUsdc);
  const perTx = limitsOf(limits)?.maxPerTx ?? 0n;
  if (!p) return <Figure label="Hôm nay">{<Skeleton className="h-11 w-40 rounded-lg" />}</Figure>;
  if (!t || t.dailyCap === 0n)
    return (
      <Figure label="Hôm nay">
        <p className="text-sm text-muted">Két chưa cho agent tiêu USDC.</p>
      </Figure>
    );
  const value = pct(t.spentToday, t.dailyCap);
  return (
    <Figure
      label="Agent đã tiêu hôm nay"
      foot={perTx > 0n ? `Tối đa ${usdc(perTx)} USDC mỗi giao dịch.` : "Không giới hạn mỗi giao dịch."}
    >
      <Amount value={usdc(t.spentToday)} unit={`/ ${usdc(t.dailyCap)} USDC`} />
      <Meter
        aria-label="Hạn mức hôm nay đã dùng"
        value={value}
        size="sm"
        color={value >= 90 ? "danger" : value >= 70 ? "warning" : "accent"}
      >
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>
    </Figure>
  );
}

function BudgetCard({
  vault,
  p,
  limits,
  unsupported,
}: {
  vault: Address;
  p: Policy | undefined;
  limits: Limits;
  unsupported: boolean;
}) {
  const l = limitsOf(limits);
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  if (unsupported)
    return (
      <Figure label="Tổng ngân sách">
        <p className="text-sm text-muted">
          Két này tạo trước khi có ngân sách tổng, nên chỉ giới hạn theo ngày.
        </p>
      </Figure>
    );
  if (!p || !limits)
    return <Figure label="Tổng ngân sách">{<Skeleton className="h-11 w-40 rounded-lg" />}</Figure>;
  if (!l || l.budget === 0n)
    return (
      <Figure label="Tổng ngân sách" foot="Đặt ở trang Quy tắc nếu muốn agent dừng sau một tổng nhất định.">
        <p className="text-heading">Không giới hạn</p>
      </Figure>
    );
  const used = pct(l.spentSinceReset, l.budget);
  const left = l.budget > l.spentSinceReset ? l.budget - l.spentSinceReset : 0n;
  const reset = () =>
    owner.request({
      title: "Làm mới ngân sách",
      summary: `Agent được tiêu lại tối đa ${usdc(l.budget)} USDC tính từ bây giờ. Hạn mức ngày và mỗi giao dịch giữ nguyên.`,
      changes: [{ label: "Đã dùng", before: `${usdc(l.spentSinceReset)} USDC`, after: "0 USDC" }],
      call: `AgentVault.resetBudget(${deployment.usdc})`,
      confirmLabel: "Ký và làm mới",
      successTitle: "Đã làm mới ngân sách",
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "resetBudget",
          args: [deployment.usdc],
          chainId: avalancheFuji.id,
        }),
    });
  return (
    <Figure
      label="Ngân sách còn lại"
      foot={
        left === 0n ? (
          <span className="text-danger">Agent đã dùng hết và đang dừng chi.</span>
        ) : (
          `Đã dùng ${usdc(l.spentSinceReset)} / ${usdc(l.budget)} USDC.`
        )
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Amount value={usdc(left)} />
        {gate.ok && l.spentSinceReset > 0n ? (
          <Button size="sm" variant={left === 0n ? "primary" : "ghost"} onPress={reset}>
            <ArrowRotateLeft aria-hidden="true" />
            Làm mới
          </Button>
        ) : null}
      </div>
      <Meter
        aria-label="Ngân sách đã dùng"
        value={used}
        size="sm"
        color={used >= 90 ? "danger" : used >= 70 ? "warning" : "accent"}
      >
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>
      {owner.dialog}
    </Figure>
  );
}

// ------------------------------------------------------------------ activity and agent

function RecentActivity() {
  const activity = useActivity(50);
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const items = activity.items.slice(0, 6);
  return (
    <Card className="min-w-0 p-2">
      <Card.Header className="flex flex-row items-center justify-between gap-3">
        <Card.Title className="text-heading">Hoạt động gần đây</Card.Title>
        {items.length ? (
          <NextLink
            href="/hoat-dong"
            className="inline-flex h-8 items-center gap-1 text-sm font-medium text-accent"
          >
            Xem tất cả
            <ArrowRight aria-hidden="true" className="size-4" />
          </NextLink>
        ) : null}
      </Card.Header>
      <Card.Content>
        <ActivityState
          isPending={activity.isPending}
          error={activity.checksError ?? activity.eventsError}
          onRetry={activity.refetch}
          empty={items.length === 0}
          emptyText="Chưa có giao dịch nào. Khi agent trả tiền, mỗi lần đều hiện ở đây: Guardian chấm gì, két quyết định ra sao."
        />
        {items.length ? <ActivityRows items={items} label="Hoạt động gần đây" onOpen={setOpen} /> : null}
      </Card.Content>
      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

function AgentCard({
  vault,
  agent,
  viewingDemo,
  onFee,
}: {
  vault: Address;
  agent: Address | undefined;
  viewingDemo: boolean;
  onFee: () => void;
}) {
  const agents = useAgents(viewingDemo ? "" : vault);
  const name = agents.data?.agents.find((a) => a.isOnChainAgent)?.name;
  const b = useBalances(agent);
  const lowGas = b.avax !== undefined && b.avax < AGENT_FEE_AVAX / 5n;
  const lowFee = b.usdc !== undefined && b.usdc < AGENT_FEE_USDC / 5n;
  return (
    <Card className="min-w-0 self-start p-2">
      <Card.Header className="flex flex-row items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-default text-foreground">
          <Cpu aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <Card.Title className="text-heading truncate">
            {agent ? (name ?? "Agent") : "Chưa có agent"}
          </Card.Title>
          {agent ? (
            <span className="text-sm text-muted">
              <AddressLink address={agent} />
            </span>
          ) : null}
        </div>
      </Card.Header>
      {agent ? (
        <Card.Content className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
              <dt className="text-muted">Phí mạng</dt>
              <dd className={`font-semibold tabular-nums ${lowGas ? "text-danger" : ""}`}>
                {b.avax === undefined ? "…" : `${formatAmount(b.avax, 18, 3)} AVAX`}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
              <dt className="text-muted">Phí Guardian</dt>
              <dd className={`font-semibold tabular-nums ${lowFee ? "text-danger" : ""}`}>
                {b.usdc === undefined ? "…" : `${formatAmount(b.usdc, 6, 2)} USDC`}
              </dd>
            </div>
          </dl>
          {lowGas || lowFee ? (
            <p className="text-sm text-danger">Ví agent sắp hết phí: agent sẽ không gửi được giao dịch.</p>
          ) : null}
        </Card.Content>
      ) : null}
      {viewingDemo ? null : (
        <Card.Footer className="flex flex-wrap gap-2">
          {agent ? (
            <Button size="sm" variant="secondary" onPress={onFee}>
              <Thunderbolt aria-hidden="true" />
              Gửi phí
            </Button>
          ) : null}
          <NextLink href="/agent" className={buttonVariants({ size: "sm", variant: "ghost" })}>
            {agent ? "Khoá API và MCP" : "Thêm agent"}
            <ArrowRight aria-hidden="true" />
          </NextLink>
        </Card.Footer>
      )}
    </Card>
  );
}
