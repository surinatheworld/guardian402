"use client";
// Tổng quan: is my money fine? The answer first (one sentence and today's count), then three figures in one
// strip (balance and withdrawing it, today's spending against the limit, the agent), what was blocked lately,
// and the rules in force. The whole feed lives on Hoạt động.
import {
  ArrowDownToLine,
  ArrowRight,
  CircleCheckFill,
  CircleDashed,
  CloudSlash,
  Cpu,
  Cubes3,
  Lock,
  Persons,
  Shield,
  ShieldCheck,
  Sliders,
  Speedometer,
} from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { Meter } from "@heroui/react/meter";
import { NumberField } from "@heroui/react/number-field";
import { Tooltip } from "@heroui/react/tooltip";
import NextLink from "next/link";
import { useState } from "react";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { ActivityDrawer, ActivityRows, ActivityState } from "@/components/activity-view";
import { EditModal } from "@/components/edit-modal";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Card, ErrorBox } from "@/components/ui";
import { useOwnerGate } from "@/components/wallet";
import { matchesFilter, type ActivityItem } from "@/lib/activity";
import { useActivity } from "@/lib/activity-hooks";
import { deployment, tokenMeta } from "@/lib/config";
import { formatAmount, fromUnits, toUnits, ZERO_ADDRESS } from "@/lib/format";
import { RISK_BY_CODE, RISK_LABEL } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";

type Policy = NonNullable<ReturnType<typeof useVaultPolicy>["data"]>;

const sameDay = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isUsdc = (t: { token: string }) => t.token.toLowerCase() === deployment.usdc.toLowerCase();

export default function Overview() {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const activity = useActivity(200);
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const today = activity.items.filter((i) => i.at && sameDay(i.at));
  const blockedToday = today.filter((i) => matchesFilter(i, "rejected")).length;
  const ranToday = today.filter((i) => matchesFilter(i, "executed")).length;
  const blocked = activity.items.filter((i) => matchesFilter(i, "rejected")).slice(0, 5);

  return (
    <>
      <Status
        failed={policy.isError}
        loading={policy.isPending}
        paused={p?.paused === true}
        empty={!activity.isPending && activity.items.length === 0}
        blockedToday={blockedToday}
        ranToday={ranToday}
      />

      {policy.isError ? (
        <ErrorBox
          title="Không đọc được két trên chain"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : (
        <section
          aria-label="Số liệu của két"
          className="grid grid-cols-1 divide-y divide-separator rounded-2xl bg-surface shadow-surface md:grid-cols-3 md:divide-x md:divide-y-0"
        >
          <Balance vault={vault} p={p} />
          <Today p={p} />
          <AgentCell p={p} />
        </section>
      )}

      {p ? <GettingStarted p={p} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-2xl bg-surface p-2 shadow-surface">
          <div className="flex min-h-8 items-center justify-between gap-3 px-3 pt-2">
            <h2 className="text-base font-semibold">Bị chặn gần đây</h2>
            {blocked.length ? (
              <NextLink
                href="/hoat-dong?xem=rejected"
                className="inline-flex h-8 items-center gap-1 text-sm font-medium text-accent"
              >
                Xem tất cả
                <ArrowRight aria-hidden="true" className="size-4" />
              </NextLink>
            ) : null}
          </div>
          <ActivityState
            isPending={activity.isPending}
            error={activity.checksError ?? activity.eventsError}
            onRetry={activity.refetch}
            empty={blocked.length === 0}
            emptyText="Chưa có giao dịch nào bị chặn. Khi agent gửi giao dịch sai luật, nó hiện ở đây kèm lý do."
          />
          {blocked.length ? (
            <div className="mt-1">
              <ActivityRows items={blocked} label="Bị chặn gần đây" onOpen={setOpen} />
            </div>
          ) : null}
        </section>
        {p ? <Rules p={p} /> : null}
      </div>

      <ActivityDrawer item={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** The answer first: is the money fine? One sentence, what happened today, and the way to the blocked ones. */
function Status(s: {
  failed: boolean;
  loading: boolean;
  paused: boolean;
  empty: boolean;
  blockedToday: number;
  ranToday: number;
}) {
  const waiting = s.failed || s.loading;
  const Icon = s.failed ? CloudSlash : s.paused ? Lock : ShieldCheck;
  const sentence = s.failed
    ? "Chưa đọc được két."
    : s.loading
      ? "Đang đọc két…"
      : s.paused
        ? "Két đang khoá. Tiền vẫn nguyên trong két."
        : s.empty
          ? "Két đang được bảo vệ. Chưa có giao dịch nào."
          : "Tiền trong két an toàn.";
  const sub = waiting
    ? null
    : s.blockedToday + s.ranToday > 0
      ? `Hôm nay Guardian và két đã chặn ${s.blockedToday} giao dịch, cho chạy ${s.ranToday}.`
      : s.empty
        ? "Thử một kịch bản ở trang Chạy thử để xem Guardian và két xử lý ra sao."
        : "Hôm nay agent chưa gửi giao dịch nào.";
  const tile = waiting
    ? "bg-default text-muted"
    : s.paused
      ? "bg-danger-soft text-danger-soft-foreground"
      : "bg-success-soft text-success-soft-foreground";
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl ${tile}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{sentence}</h1>
          {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
        </div>
      </div>
      {waiting ? null : s.blockedToday > 0 ? (
        <NextLink href="/hoat-dong?xem=rejected" className={buttonVariants({ variant: "primary" })}>
          Xem {s.blockedToday} giao dịch bị chặn
          <ArrowRight aria-hidden="true" />
        </NextLink>
      ) : s.empty ? (
        <NextLink href="/chay-thu" className={buttonVariants({ variant: "primary" })}>
          Chạy thử một giao dịch
          <ArrowRight aria-hidden="true" />
        </NextLink>
      ) : null}
    </header>
  );
}

function Balance({ vault, p }: { vault: `0x${string}`; p: Policy | undefined }) {
  const usdc = p?.tokens.find(isUsdc);
  const gate = useOwnerGate(p?.owner);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(0);
  const balance = usdc?.balance ?? 0n;
  const tooMuch = toUnits(amount, 6) > balance;
  const withdraw = (
    <Button
      variant="outline"
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
  );

  return (
    <div className="flex min-w-0 flex-col p-5">
      <h2 className="text-sm text-muted">Số dư trong két</h2>
      <p className="mt-1 text-2xl font-semibold tracking-tight wrap-anywhere tabular-nums sm:text-3xl">
        {usdc ? formatAmount(usdc.balance, 6, 2) : "—"}
        <span className="text-base font-medium text-muted"> USDC</span>
      </p>
      <div className="mt-3 self-start">
        {!gate.ok && gate.reason !== "loading" ? (
          <Tooltip delay={200}>
            <Tooltip.Trigger>
              <span tabIndex={0} aria-label={`Rút về ví chủ: ${gate.message}`}>
                {withdraw}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content className="max-w-64 text-sm">{gate.message}</Tooltip.Content>
          </Tooltip>
        ) : (
          withdraw
        )}
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
    </div>
  );
}

function Today({ p }: { p: Policy | undefined }) {
  const usdc = p?.tokens.find(isUsdc);
  const m = tokenMeta(deployment.usdc);
  const percent =
    usdc && usdc.dailyCap > 0n
      ? Number(
          ((usdc.spentToday > usdc.dailyCap ? usdc.dailyCap : usdc.spentToday) * 1000n) / usdc.dailyCap,
        ) / 10
      : 0;
  const left = usdc ? (usdc.dailyCap > usdc.spentToday ? usdc.dailyCap - usdc.spentToday : 0n) : 0n;
  return (
    <div className="flex min-w-0 flex-col p-5">
      <h2 className="text-sm text-muted">Agent đã tiêu hôm nay</h2>
      {usdc ? (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight wrap-anywhere tabular-nums">
            {formatAmount(usdc.spentToday, m.decimals, 2)}
            <span className="text-sm font-medium text-muted">
              {" "}
              / {formatAmount(usdc.dailyCap, m.decimals, 2)} USDC
            </span>
          </p>
          <Meter
            aria-label="Hạn mức mỗi ngày đã dùng"
            valueLabel={`${String(percent).replace(".", ",")}%`}
            value={percent}
            size="sm"
            color={percent >= 90 ? "danger" : percent >= 70 ? "warning" : "accent"}
            className="mt-2 w-full"
          >
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>
          <p className="mt-2 text-sm text-muted tabular-nums">Còn {formatAmount(left, m.decimals, 2)} USDC</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{p ? "Két chưa đặt hạn mức USDC." : "Đang đọc két…"}</p>
      )}
    </div>
  );
}

function AgentCell({ p }: { p: Policy | undefined }) {
  const usdc = p?.tokens.find(isUsdc);
  const m = tokenMeta(deployment.usdc);
  return (
    <div className="flex min-w-0 flex-col p-5">
      <h2 className="text-sm text-muted">Agent đang có quyền</h2>
      <p className="mt-1 flex items-center gap-2 text-sm font-medium">
        <Cpu aria-hidden="true" className="size-4 shrink-0 text-muted" />
        {p?.agent === ZERO_ADDRESS ? "Chưa có" : p ? <AddressLink address={p.agent} /> : "—"}
      </p>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Cần Guardian duyệt từ</dt>
          <dd className="font-medium tabular-nums">
            {usdc ? `${formatAmount(usdc.verdictThreshold, m.decimals, 2)} USDC` : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The rules in force, as four figures, and the way to change them. */
function Rules({ p }: { p: Policy }) {
  const usdc = p.tokens.find(isUsdc);
  const rows: [typeof Speedometer, string, string][] = [
    [Speedometer, "Hạn mức mỗi ngày", usdc ? `${formatAmount(usdc.dailyCap, 6, 2)} USDC` : "Chưa đặt"],
    [Persons, "Người nhận tin cậy", String(p.recipients.length)],
    [Cubes3, "Ứng dụng được dùng", String(p.targets.length)],
    [Shield, "Rủi ro tối đa", capital(RISK_LABEL[RISK_BY_CODE[p.maxAgentRisk] ?? "LOW"])],
  ];
  return (
    <section className="flex flex-col gap-3 self-start rounded-2xl bg-surface p-5 shadow-surface">
      <h2 className="flex min-h-8 items-center text-base font-semibold">Luật đang áp dụng</h2>
      <ul className="flex flex-col gap-2.5 text-sm">
        {rows.map(([Icon, label, value]) => (
          <li key={label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
            </span>
            <span className="font-medium tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      <NextLink
        href="/quy-tac"
        className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
      >
        <Sliders aria-hidden="true" />
        Sửa quy tắc
      </NextLink>
    </section>
  );
}

/** The first three things a new owner does. Shown only until all three are done. */
function GettingStarted({ p }: { p: Policy }) {
  const usdc = p.tokens.find(isUsdc);
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
