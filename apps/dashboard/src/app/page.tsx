"use client";
// Tổng quan: is my money fine, and is there anything to deal with? Balance (and withdrawing it), today's
// spending against the daily limit, what needs attention, and the latest activity.
import { ArrowDownToLine, ArrowRight, CircleCheckFill, CircleDashed } from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { Meter } from "@heroui/react/meter";
import { NumberField } from "@heroui/react/number-field";
import NextLink from "next/link";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { ActivityDrawer, ActivityList, ActivityState } from "@/components/activity-view";
import { EditModal } from "@/components/edit-modal";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Card, ErrorBox, PageHeader, Term } from "@/components/ui";
import { useOwnerGate } from "@/components/wallet";
import { needsAttention, type ActivityItem } from "@/lib/activity";
import { useActivity } from "@/lib/activity-hooks";
import { deployment, tokenMeta } from "@/lib/config";
import { formatAmount, fromUnits, toUnits, ZERO_ADDRESS } from "@/lib/format";
import { DEMO_NAME, PAGE } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";

type Policy = NonNullable<ReturnType<typeof useVaultPolicy>["data"]>;

export default function Overview() {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const activity = useActivity(50);
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const attention = activity.items.filter(needsAttention).slice(0, 3);
  const recent = activity.items.slice(0, 5);

  return (
    <>
      <PageHeader title={PAGE.home} />

      {policy.isError ? (
        <ErrorBox
          title="Không đọc được két trên chain"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Balance vault={vault} p={p} />
        <Today p={p} />
      </div>

      {p ? <GettingStarted p={p} /> : null}

      <Card
        title="Cần chú ý"
        description={attention.length ? "Giao dịch rủi ro cao hoặc bị két từ chối" : undefined}
        actions={
          attention.length ? (
            <NextLink href="/hoat-dong?xem=high" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Xem tất cả
              <ArrowRight aria-hidden="true" />
            </NextLink>
          ) : null
        }
      >
        <ActivityState
          isPending={activity.isPending}
          error={activity.checksError}
          onRetry={activity.refetch}
          empty={false}
          emptyText=""
        />
        {!activity.isPending && attention.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CircleCheckFill aria-hidden="true" className="size-4 text-success" />
            Không có gì cần xử lý.
          </p>
        ) : null}
        {attention.length ? <ActivityList items={attention} label="Cần chú ý" onOpen={setOpen} /> : null}
      </Card>

      <Card
        title="Gần đây"
        actions={
          <NextLink href="/hoat-dong" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Tất cả hoạt động
            <ArrowRight aria-hidden="true" />
          </NextLink>
        }
      >
        <ActivityState
          isPending={activity.isPending}
          error={activity.checksError ?? activity.eventsError}
          onRetry={activity.refetch}
          empty={recent.length === 0}
          emptyText="Chưa có giao dịch nào. Thử một kịch bản ở trang Chạy thử."
        />
        {recent.length ? <ActivityList items={recent} label="Hoạt động gần đây" onOpen={setOpen} /> : null}
      </Card>

      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Balance({ vault, p }: { vault: `0x${string}`; p: Policy | undefined }) {
  const usdc = p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());
  const wavax = useReadContract({
    address: deployment.mWAVAX,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [vault],
    query: { refetchInterval: 10_000 },
  });
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(0);
  const balance = usdc?.balance ?? 0n;
  const tooMuch = toUnits(amount, 6) > balance;

  return (
    <Card title="Số dư trong két">
      <div className="flex flex-col gap-1">
        <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {usdc ? formatAmount(usdc.balance, 6, 2) : "—"}
          <span className="ml-2 text-lg font-medium text-muted">USDC</span>
        </span>
        <span className="text-sm text-muted tabular-nums">
          {wavax.data !== undefined ? `${formatAmount(wavax.data, 18)} mWAVAX` : "—"}
          <span className="sr-only"> ({DEMO_NAME.wavax})</span> ·{" "}
          {p ? `${formatAmount(p.nativeBalance, 18)} AVAX` : "—"}
        </span>
      </div>
      <p className="text-sm text-muted">Tiền nằm trong két của bạn. Guardian chỉ duyệt, không rút được.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!gate.ok || balance === 0n}
          onPress={() => {
            setAmount(fromUnits(balance, 6));
            setEditing(true);
          }}
        >
          <ArrowDownToLine aria-hidden="true" />
          Rút về ví chủ
        </Button>
        {!gate.ok && gate.reason !== "loading" ? (
          <span className="text-xs text-muted">{gate.message}</span>
        ) : null}
      </div>
      <EditModal
        isOpen={editing}
        onOpenChange={setEditing}
        title="Rút USDC về ví chủ"
        isSubmitDisabled={amount <= 0 || tooMuch}
        onSubmit={() => {
          setEditing(false);
          if (!p) return;
          const raw = toUnits(amount, 6);
          owner.request({
            title: "Rút USDC về ví chủ",
            summary: (
              <>
                Chuyển {formatAmount(raw, 6, 6)} USDC từ két về ví chủ <AddressLink address={p.owner} />.
              </>
            ),
            changes: [
              {
                label: "Số dư két",
                before: `${formatAmount(balance, 6, 6)} USDC`,
                after: `${formatAmount(balance - raw, 6, 6)} USDC`,
              },
            ],
            call: `AgentVault.withdraw(USDC, ${p.owner}, ${raw})`,
            confirmLabel: "Ký và rút",
            successTitle: "Đã rút về ví chủ",
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
          step={0.5}
          formatOptions={{ maximumFractionDigits: 6 }}
          isInvalid={tooMuch}
          autoFocus
        >
          <Label>Số tiền (USDC)</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <Description>Có trong két: {formatAmount(balance, 6, 6)} USDC</Description>
        </NumberField>
      </EditModal>
      {owner.dialog}
    </Card>
  );
}

function Today({ p }: { p: Policy | undefined }) {
  const usdc = p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());
  const m = tokenMeta(deployment.usdc);
  const percent =
    usdc && usdc.dailyCap > 0n
      ? Number(
          ((usdc.spentToday > usdc.dailyCap ? usdc.dailyCap : usdc.spentToday) * 1000n) / usdc.dailyCap,
        ) / 10
      : 0;
  const left = usdc ? (usdc.dailyCap > usdc.spentToday ? usdc.dailyCap - usdc.spentToday : 0n) : 0n;
  return (
    <Card
      title="Agent đã tiêu hôm nay"
      actions={
        <NextLink href="/quy-tac" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Sửa quy tắc
        </NextLink>
      }
    >
      {usdc ? (
        <>
          <Meter
            value={percent}
            color={percent >= 90 ? "danger" : percent >= 70 ? "warning" : "accent"}
            valueLabel={`${formatAmount(usdc.spentToday, m.decimals)} / ${formatAmount(usdc.dailyCap, m.decimals)} USDC`}
            className="w-full"
          >
            <Label>Hạn mức mỗi ngày</Label>
            <Meter.Output className="tabular-nums" />
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Còn được tiêu</dt>
            <dd className="text-right font-medium tabular-nums">{formatAmount(left, m.decimals)} USDC</dd>
            <dt className="text-muted">
              <Term tip="Giao dịch từ mức này trở lên phải kèm phê duyệt của Guardian, nếu không két từ chối.">
                Cần Guardian duyệt từ
              </Term>
            </dt>
            <dd className="text-right font-medium tabular-nums">
              {formatAmount(usdc.verdictThreshold, m.decimals)} USDC
            </dd>
            <dt className="text-muted">Agent</dt>
            <dd className="flex justify-end">
              {p?.agent === ZERO_ADDRESS ? "Chưa có" : p ? <AddressLink address={p.agent} /> : "—"}
            </dd>
          </dl>
          <p className="text-xs text-muted">Hạn mức đặt lại lúc 07:00 mỗi ngày (00:00 UTC).</p>
        </>
      ) : (
        <p className="text-sm text-muted">{p ? "Két chưa đặt hạn mức USDC." : "Đang đọc két…"}</p>
      )}
    </Card>
  );
}

/** The first three things a new owner does. Shown only until all three are done. */
function GettingStarted({ p }: { p: Policy }) {
  const usdc = p.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());
  const steps = [
    { done: (usdc?.balance ?? 0n) > 0n, label: "Nạp USDC vào két", href: null },
    { done: (usdc?.dailyCap ?? 0n) > 0n, label: "Đặt quy tắc chi tiêu", href: "/quy-tac" },
    { done: p.agent !== ZERO_ADDRESS, label: "Kết nối agent", href: "/agent" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <Card title="Bắt đầu" description="Ba việc để agent chi tiêu an toàn từ két này">
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            {s.done ? (
              <CircleCheckFill aria-hidden="true" className="size-4 text-success" />
            ) : (
              <CircleDashed aria-hidden="true" className="size-4 text-muted" />
            )}
            <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
            {!s.done && s.href ? (
              <NextLink href={s.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Làm ngay
              </NextLink>
            ) : null}
            {!s.done && !s.href ? (
              <span className="text-xs text-muted">Gửi USDC tới địa chỉ két ở thanh bên</span>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
