"use client";
// Activity as the owner reads it: a dense table (one transaction per row), compact rows for the overview, and
// the detail drawer. The drawer opens with the conclusion ("the vault rejected it, the money is still there"),
// then the three stops, with the way to act on a rejection next to the vault's decision.
import {
  CircleCheck,
  CircleXmark,
  Flask,
  OctagonXmark,
  PersonPlus,
  Sliders,
  TriangleExclamation,
} from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Description } from "@heroui/react/description";
import { Drawer } from "@heroui/react/drawer";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { Tabs } from "@heroui/react/tabs";
import { TextField } from "@heroui/react/textfield";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import NextLink from "next/link";
import { useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import { checkIdOf, moneyEffects, type ActivityItem } from "@/lib/activity";
import {
  useCheckDetail,
  useCheckDetails,
  useExecutionFlows,
  type CheckDetail,
  type ExecutionFlow,
} from "@/lib/activity-hooks";
import { errorText } from "@/lib/api";
import { useMe } from "@/lib/account";
import { vaultDecision } from "@/lib/check-calls";
import { knownName, tokenMeta } from "@/lib/config";
import { formatAmount, formatTime, shortHex } from "@/lib/format";
import { ENDPOINT_PATH, findingLabel, revertLabel } from "@/lib/labels";
import { scenarioTitle } from "@/lib/scenarios";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import { REVIEW_LABEL, useInvalidate, useWorkspaceChecks, wsApi, type ReviewStatus } from "@/lib/workspace";
import { proposalText } from "./journey";
import { OnChainFeedback } from "./reputation";
import { ErrorBox, LoadingRows, RiskBadge, TechDetails, TxLink } from "./ui";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The headline of an item: what happened, in one line. */
/** "Chuyển 1,5 USDC tới Treasury": an execution's transfers out of the vault, from its receipt. */
function flowText(flows: ExecutionFlow[] | undefined): string | undefined {
  if (!flows?.length) return undefined;
  return flows
    .map((x) => {
      const m = tokenMeta(x.token);
      return `Chuyển ${formatAmount(x.amount, m.decimals, 4)} ${m.symbol} tới ${knownName(x.to) ?? shortHex(x.to)}`;
    })
    .join(" · ");
}

/** "−1,5 USDC" for the first transfer out, or undefined. */
function flowAmount(flows: ExecutionFlow[] | undefined): string | undefined {
  const x = flows?.[0];
  if (!x) return undefined;
  const m = tokenMeta(x.token);
  return `−${formatAmount(x.amount, m.decimals, 4)} ${m.symbol}`;
}

const flowsOf = (item: ActivityItem, flows: Map<string, ExecutionFlow[]>) =>
  item.execution && !item.check ? flows.get(item.execution.txHash.toLowerCase()) : undefined;

function headline(
  item: ActivityItem,
  detail: CheckDetail | undefined,
  vault: string,
  flows?: ExecutionFlow[],
) {
  if (item.attempt) return scenarioTitle(item.attempt.scenario);
  return proposalText(item, detail, vault, flowText(flows));
}

type Tone = "ok" | "bad" | "neutral";
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success-soft-foreground",
  bad: "text-danger-soft-foreground",
  neutral: "text-muted",
};
const TONE_SOFT: Record<Tone, string> = {
  ok: "bg-success-soft text-success-soft-foreground",
  bad: "bg-danger-soft text-danger-soft-foreground",
  neutral: "bg-default text-foreground",
};

/** What the vault did (or, for a trial, would do), as a word, a tone and the reason in the owner's words. */
function vaultView(item: ActivityItem, detail: CheckDetail | undefined, maxAgentRisk: number | undefined) {
  const o = item.outcome;
  if (o.kind === "executed")
    return {
      tone: "ok" as Tone,
      label: "Đã thực hiện",
      why:
        item.execution && !item.execution.withVerdict
          ? "Khoản nhỏ: két chi thẳng, không tốn phí Guardian"
          : "",
      Icon: CircleCheck,
    };
  if (o.kind === "rejected")
    return {
      tone: "bad" as Tone,
      label: "Két từ chối",
      why: capital(revertLabel(o.reason)),
      Icon: OctagonXmark,
    };
  if (o.kind === "trial") {
    const d = detail
      ? vaultDecision(
          {
            findings: detail.findings,
            riskCode: ["LOW", "MEDIUM", "HIGH"].indexOf(detail.risk) as 0 | 1 | 2,
          },
          maxAgentRisk,
        )
      : null;
    return {
      tone: (d ? (d.blocked ? "bad" : "ok") : "neutral") as Tone,
      label: d ? (d.blocked ? "Két sẽ từ chối" : "Két sẽ chấp nhận") : "Chỉ chạy thử",
      why: d ? d.text : "Không gửi lên chain",
      Icon: d ? (d.blocked ? OctagonXmark : CircleCheck) : Flask,
    };
  }
  if (o.kind === "check-only")
    return {
      tone: "neutral" as Tone,
      label: "Chưa gửi",
      why: "Chỉ kiểm tra, Guardian không ký duyệt",
      Icon: Flask,
    };
  // A co-signed check that never reached the vault: when the vault would have refused it (risk above the
  // owner's maximum, or a rule it breaks), the agent's MCP `pay` stopped before sending. Say so.
  const d = detail
    ? vaultDecision(
        { findings: detail.findings, riskCode: ["LOW", "MEDIUM", "HIGH"].indexOf(detail.risk) as 0 | 1 | 2 },
        maxAgentRisk,
      )
    : null;
  if (d?.blocked)
    return { tone: "bad" as Tone, label: "Chặn trước khi gửi", why: d.text, Icon: OctagonXmark };
  return {
    tone: "neutral" as Tone,
    label: "Chưa thấy trên két",
    why: "Agent chưa gửi giao dịch này",
    Icon: Flask,
  };
}

function VaultResult({ view }: { view: ReturnType<typeof vaultView> }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${TONE_TEXT[view.tone]}`}
    >
      <view.Icon aria-hidden="true" className="size-4 shrink-0" />
      {view.label}
    </span>
  );
}

const projectedOutflow = (detail: CheckDetail | undefined) =>
  detail && moneyEffects(detail.diff).find((line) => line.raw < 0n);

/** What would leave the vault, as one short figure for a table cell ("−2 USDC"), or "—". */
function outflow(detail: CheckDetail | undefined): string {
  if (!detail) return "—";
  const out = projectedOutflow(detail);
  if (out) return `−${formatAmount(-out.raw, out.decimals, 4)} ${out.symbol}`;
  return detail.diff.approvals.length ? "Cấp quyền" : "—";
}

const guardianCell = (item: ActivityItem, withScore: boolean) =>
  item.risk ? (
    <RiskBadge risk={item.risk} score={withScore ? item.check?.score : undefined} />
  ) : item.execution?.withVerdict ? (
    // Approved, but by a Guardian whose check is not in this one's history (e.g. another instance).
    <span className="text-sm text-success-soft-foreground">Đã duyệt</span>
  ) : (
    <span className="text-sm text-muted">Không cần duyệt</span>
  );

type ListProps = { items: ActivityItem[]; label: string; onOpen: (item: ActivityItem) => void };

/** One transaction per row; risk and the vault's decision line up in columns. A row opens the detail. */
export function ActivityTable({ items, label, onOpen }: ListProps) {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const details = useCheckDetails(items.flatMap((i) => (i.check ? [i.check.checkId] : [])));
  const flows = useExecutionFlows(items, vault);
  return (
    <table aria-label={label} className="w-full table-fixed border-collapse text-left">
      <thead>
        <tr className="text-xs text-muted">
          <th className="h-10 pr-3 pl-4 font-medium">Giao dịch</th>
          <th className="hidden w-44 px-3 font-medium md:table-cell xl:w-56">Guardian</th>
          <th className="hidden w-36 px-3 font-medium md:table-cell xl:w-40">Két</th>
          <th className="hidden w-32 px-3 text-right font-medium xl:table-cell">Số tiền</th>
          <th className="w-28 pr-4 pl-3 text-right font-medium">Lúc</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const detail = item.check ? details.get(item.check.checkId) : undefined;
          const itemFlows = flowsOf(item, flows);
          const title = headline(item, detail, vault, itemFlows);
          const view = vaultView(item, detail, policy.data?.maxAgentRisk);
          const amount = detail ? outflow(detail) : (flowAmount(itemFlows) ?? "—");
          return (
            <tr
              key={item.id}
              className="relative border-t border-separator transition-colors hover:bg-default/60"
            >
              <td className="py-3 pr-3 pl-4">
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="line-clamp-2 cursor-pointer text-left text-sm font-medium after:absolute after:inset-0 md:line-clamp-1"
                  title={title}
                >
                  {title}
                </button>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {view.why ||
                    (item.attempt?.mode === "scripted-attack" ? "Tấn công mô phỏng" : "Guardian đã duyệt")}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
                  {guardianCell(item, false)}
                  <VaultResult view={view} />
                </span>
              </td>
              <td className="hidden px-3 md:table-cell">{guardianCell(item, true)}</td>
              <td className="hidden px-3 md:table-cell">
                <VaultResult view={view} />
              </td>
              <td
                className={`hidden px-3 text-right text-sm tabular-nums xl:table-cell ${amountClass(item)}`}
                title={amountTitle(item)}
              >
                {amount}
              </td>
              <td className="py-3 pr-4 pl-3 text-right align-top text-xs text-muted tabular-nums md:align-middle">
                {/* Below xl the amount column is hidden: the amount sits above the time instead. */}
                <span
                  className={`mb-0.5 block text-sm xl:hidden ${amountClass(item)}`}
                  title={amountTitle(item)}
                >
                  {amount}
                </span>
                {item.at ? formatTime(item.at) : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const shortTime = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Money that really left the vault reads as such; an amount that never left (blocked, check only) is struck. */
const amountClass = (item: ActivityItem) =>
  item.outcome.kind === "executed" ? "font-medium" : "text-muted line-through decoration-muted/60";
const amountTitle = (item: ActivityItem) =>
  item.outcome.kind === "executed" ? "Đã rời két" : "Không rời két: giao dịch không được thực hiện";

/** The overview's short list: name and reason, risk, what would have left, when. */
export function ActivityRows({ items, label, onOpen }: ListProps) {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const details = useCheckDetails(items.flatMap((i) => (i.check ? [i.check.checkId] : [])));
  const flows = useExecutionFlows(items, vault);
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => {
        const detail = item.check ? details.get(item.check.checkId) : undefined;
        const itemFlows = flowsOf(item, flows);
        const title = headline(item, detail, vault, itemFlows);
        const view = vaultView(item, detail, policy.data?.maxAgentRisk);
        const out = projectedOutflow(detail);
        const first = itemFlows?.[0];
        const firstMeta = first ? tokenMeta(first.token) : undefined;
        const amount = out
          ? `−${formatAmount(-out.raw, out.decimals, 4)}`
          : first && firstMeta
            ? `−${formatAmount(first.amount, firstMeta.decimals, 4)}`
            : "—";
        const unit = (out?.symbol ?? firstMeta?.symbol) === "USDC" ? "" : (out?.symbol ?? firstMeta?.symbol);
        const time = item.at ? (
          <time dateTime={new Date(item.at).toISOString()} title={formatTime(item.at)}>
            {shortTime.format(item.at)}
          </time>
        ) : null;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="grid w-full cursor-pointer grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-default/60 sm:grid-cols-[minmax(0,1fr)_auto_72px_48px]"
            >
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium sm:line-clamp-1" title={title}>
                  {title}
                </span>
                <span className="block truncate text-sm text-muted">{view.why || view.label}</span>
              </span>
              <span className="flex items-center justify-between gap-3 sm:contents">
                {/* The owner's question here is "paid or stopped?": the vault's decision, not the risk badge
                    (a low-risk payment can still be refused by the vault). Risk stays in the detail drawer. */}
                <span className="sm:justify-self-end">
                  <VaultResult view={view} />
                </span>
                <span className="text-xs text-muted tabular-nums sm:hidden">
                  {out && (
                    <>
                      <span className="sr-only">
                        {item.outcome.kind === "executed" ? "Đã rời két " : "Không rời két "}
                      </span>
                      {amount} {out.symbol} ·{" "}
                    </>
                  )}
                  {time}
                </span>
              </span>
              <span
                className={`hidden text-right text-sm wrap-anywhere tabular-nums sm:block ${out ? amountClass(item) : "text-muted"}`}
                title={out ? amountTitle(item) : undefined}
              >
                {out && (
                  <span className="sr-only">
                    {item.outcome.kind === "executed" ? "Đã rời két " : "Không rời két "}
                  </span>
                )}
                {amount}
                {unit ? ` ${unit}` : null}
                {out?.symbol === "USDC" && <span className="sr-only"> USDC</span>}
              </span>
              <span className="hidden text-right text-xs text-muted tabular-nums sm:block">{time}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Review({ checkId }: { checkId: string }) {
  const { address: vault } = useSelectedVault();
  const me = useMe();
  const linked = me.data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? false;
  return linked ? <ReviewForm checkId={checkId} vault={vault} /> : null;
}

function ReviewForm({ checkId, vault }: { checkId: string; vault: string }) {
  const checks = useWorkspaceChecks(vault);
  const current = checks.data?.checks.find((c) => c.checkId === checkId)?.review ?? null;
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const invalidate = useInvalidate(vault);
  const save = useMutation({
    mutationFn: () =>
      wsApi(vault, `checks/${checkId}/review`, "PUT", {
        status: status ?? current?.status ?? "reviewed",
        note: note ?? current?.note ?? "",
      }),
    onSuccess: () => {
      void invalidate("checks");
      toast.success("Đã lưu đánh giá");
    },
    onError: (e) => toast.danger("Chưa lưu được đánh giá", { description: errorText(e) }),
  });
  return (
    <section className="flex flex-col gap-3 border-t border-separator pt-4" aria-labelledby="review-h">
      <h3 id="review-h" className="text-sm font-semibold">
        Đánh giá của bạn
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Select
          variant="secondary"
          value={status ?? current?.status ?? "reviewed"}
          onChange={(k) => k !== null && setStatus(k as ReviewStatus)}
        >
          <Label>Kết luận</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((s) => (
                <ListBox.Item key={s} id={s} textValue={REVIEW_LABEL[s]}>
                  {REVIEW_LABEL[s]}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField value={note ?? current?.note ?? ""} onChange={setNote} maxLength={500}>
          <Label>Ghi chú</Label>
          <Input variant="secondary" placeholder="Ví dụ: đã chặn ví này ở sàn" />
        </TextField>
      </div>
      <Description className="text-xs text-muted">
        Ghi chú cho riêng bạn; không đổi mức rủi ro và không đổi gì trên chain.
      </Description>
      <Button
        size="sm"
        variant="tertiary"
        className="self-start"
        isPending={save.isPending}
        onPress={() => save.mutate()}
      >
        Lưu đánh giá
      </Button>
      <OnChainFeedback
        vault={vault as Address}
        checkId={checkId as Hex}
        status={status ?? current?.status ?? "reviewed"}
      />
    </section>
  );
}

/** One numbered stop of the journey, stacked: the number carries the stop's tone. */
function Stop({ n, label, tone, children }: { n: number; label: string; tone: Tone; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${TONE_SOFT[tone]}`}
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2 pb-5">
        <h3 className="text-xs font-medium text-muted">{label}</h3>
        {children}
      </div>
    </li>
  );
}

/** Where the owner goes to act on a rejection. A link to the rule, never a change made from here. */
function fixFor(reason: string | undefined): { href: string; label: string; Icon: typeof Sliders } | null {
  if (reason === "RecipientNotAllowed" || reason === "TargetNotAllowed")
    return { href: "/quy-tac#nguoi-nhan", label: "Xem người nhận tin cậy", Icon: PersonPlus };
  if (reason === "RiskTooHigh") return { href: "/quy-tac", label: "Xem mức rủi ro tối đa", Icon: Sliders };
  if (reason === "DailyCapExceeded") return { href: "/quy-tac#han-muc", label: "Xem hạn mức", Icon: Sliders };
  return null;
}

export function DetailBody({ item }: { item: ActivityItem }) {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const checkId = checkIdOf(item);
  const q = useCheckDetail(checkId);
  const detail = q.data;
  const drawerFlows = useExecutionFlows([item], vault);
  const findings = detail?.findings ?? [];
  const explanation = detail?.explanation ?? item.check?.explanation ?? null;
  const o = item.outcome;
  const view = vaultView(item, detail, policy.data?.maxAgentRisk);
  const money = detail ? moneyEffects(detail.diff) : [];
  const happened = o.kind === "executed";
  const fix = o.kind === "rejected" ? fixFor(o.reason) : null;
  const guardianTone: Tone = item.risk === "HIGH" ? "bad" : item.risk === "LOW" ? "ok" : "neutral";
  const conclusion =
    o.kind === "rejected"
      ? `Két đã từ chối: ${revertLabel(o.reason)}`
      : o.kind === "executed"
        ? "Két đã thực hiện giao dịch này"
        : o.kind === "trial"
          ? view.label
          : view.label;
  return (
    <div className="flex flex-col gap-5">
      <div className={`rounded-xl p-3 ${TONE_SOFT[view.tone]}`}>
        <p className="flex items-start gap-2 text-sm font-semibold">
          <view.Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {conclusion}
        </p>
        {o.kind === "rejected" ? (
          <p className="mt-1 text-sm">Tiền vẫn ở trong két. Không có gì bị chuyển đi.</p>
        ) : o.kind === "trial" ? (
          <p className="mt-1 text-sm">{view.why}</p>
        ) : null}
      </div>

      {money.length ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {money.map((l) => (
            <div key={l.symbol}>
              <dt className="text-xs text-muted">
                {l.raw < 0n
                  ? happened
                    ? "Rời két"
                    : "Nếu chạy, rời két"
                  : happened
                    ? "Vào két"
                    : "Nếu chạy, vào két"}
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {l.raw > 0n ? "+" : "−"}
                {formatAmount(l.raw < 0n ? -l.raw : l.raw, l.decimals, 6)} {l.symbol}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {q.isPending && checkId ? <LoadingRows rows={2} label="Đang đọc kết quả kiểm tra" /> : null}
      {q.isError ? (
        <ErrorBox
          title="Không đọc được kết quả kiểm tra"
          detail={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : null}

      <ol aria-label="Hành trình giao dịch" className="flex flex-col">
        <Stop n={1} label="Agent đề xuất" tone="neutral">
          <p className="text-sm">
            {proposalText(item, detail, vault, flowText(flowsOf(item, drawerFlows)))}
            {item.attempt?.mode === "scripted-attack" ? (
              <Chip size="sm" variant="tertiary" className="ml-2 align-middle">
                Tấn công mô phỏng
              </Chip>
            ) : null}
          </p>
        </Stop>

        <Stop n={2} label="Guardian kiểm tra" tone={guardianTone}>
          <div>{guardianCell(item, true)}</div>
          {findings.length ? (
            <ul className="flex flex-col gap-2" aria-label="Lý do">
              {findings.map((f, i) => (
                <li key={`${f.ruleId}-${i}`} className="flex gap-2 text-sm">
                  {f.severity === "HIGH" ? (
                    <CircleXmark
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-danger-soft-foreground"
                    />
                  ) : (
                    <TriangleExclamation
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground"
                    />
                  )}
                  <span>{findingLabel(f)}</span>
                </li>
              ))}
            </ul>
          ) : item.risk ? (
            <p className="text-sm text-muted">Không thấy dấu hiệu bất thường.</p>
          ) : null}
          {explanation ? (
            <Tabs defaultSelectedKey="vi" className="gap-2">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Ngôn ngữ của lời giải thích">
                  <Tabs.Tab id="vi" className="whitespace-nowrap">
                    Tiếng Việt
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="en" className="whitespace-nowrap">
                    English
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="vi" className="p-0">
                <p className="text-sm leading-6 whitespace-pre-line">{explanation.vi}</p>
              </Tabs.Panel>
              <Tabs.Panel id="en" className="p-0">
                <p lang="en" className="text-sm leading-6 whitespace-pre-line">
                  {explanation.en}
                </p>
              </Tabs.Panel>
              <p className="text-xs text-muted">
                {explanation.source === "llm" ? "Do AI viết từ kết quả chạy thử." : "Lấy từ mẫu cố định."} Mức
                rủi ro chỉ do bộ luật quyết định.
              </p>
            </Tabs>
          ) : null}
        </Stop>

        <Stop
          n={3}
          label={o.kind === "trial" ? "Két quyết định (dự đoán)" : "Két quyết định"}
          tone={view.tone}
        >
          <div>
            <VaultResult view={view} />
          </div>
          {view.why ? (
            <p className="text-sm">
              {view.why}
              {/[.!?]$/.test(view.why) ? "" : "."}
            </p>
          ) : null}
          {(o.kind === "executed" || o.kind === "rejected") && o.tx ? (
            <TxLink hash={o.tx} label="Xem giao dịch" />
          ) : null}
          {fix ? (
            <NextLink
              href={fix.href}
              className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
            >
              <fix.Icon aria-hidden="true" />
              {fix.label}
            </NextLink>
          ) : null}
        </Stop>
      </ol>

      {checkId && o.kind !== "trial" ? <Review checkId={checkId} /> : null}

      <TechDetails>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          {item.check ? (
            <>
              <dt>checkId</dt>
              <dd className="font-mono break-all">{item.check.checkId}</dd>
              <dt>Endpoint</dt>
              <dd className="font-mono">{ENDPOINT_PATH[item.check.endpoint] ?? item.check.endpoint}</dd>
              <dt>Thời gian xử lý</dt>
              <dd className="tabular-nums">{item.check.latencyMs} ms</dd>
              <dt>Mã luật</dt>
              <dd className="font-mono break-all">{item.check.ruleIds.join(", ") || "không có"}</dd>
            </>
          ) : null}
          {detail?.simulation ? (
            <>
              <dt>Chạy thử</dt>
              <dd className="tabular-nums">
                {detail.simulation.success
                  ? "thành công"
                  : `thất bại${detail.simulation.revertReason ? `: ${detail.simulation.revertReason}` : ""}`}{" "}
                · block {detail.simulation.forkBlock} · gas {detail.simulation.gasUsed}
              </dd>
            </>
          ) : null}
          {detail?.verdict ? (
            <>
              <dt>Phê duyệt</dt>
              <dd className="tabular-nums">
                nonce {detail.verdict.nonce} · hết hạn {formatTime(detail.verdict.deadline * 1000)}
              </dd>
            </>
          ) : null}
          {(detail?.payment ?? item.check?.paymentTx) ? (
            <>
              <dt>Phí kiểm tra (x402)</dt>
              <dd>
                <TxLink hash={detail?.payment?.txHash ?? item.check?.paymentTx ?? ""} />
              </dd>
            </>
          ) : null}
          {item.execution ? (
            <>
              <dt>Giao dịch két</dt>
              <dd>
                <TxLink hash={item.execution.txHash} /> · block {item.execution.blockNumber.toString()}
              </dd>
            </>
          ) : null}
          {o.kind === "rejected" && o.reason ? (
            <>
              <dt>Lỗi của két</dt>
              <dd className="font-mono">{o.reason}</dd>
            </>
          ) : null}
          {item.attempt ? (
            <>
              <dt>Kịch bản</dt>
              <dd>
                {item.attempt.scenario} ·{" "}
                {item.attempt.matched
                  ? "khớp kết quả mong đợi"
                  : `khác mong đợi: ${item.attempt.mismatch ?? ""}`}
              </dd>
            </>
          ) : null}
        </dl>
      </TechDetails>
    </div>
  );
}

/** The detail of one activity item, in a drawer from the right (from the bottom on a phone). */
export function ActivityDrawer({ item, onClose }: { item: ActivityItem | null; onClose: () => void }) {
  const { address: vault } = useSelectedVault();
  const detail = useCheckDetail(item ? checkIdOf(item) : undefined).data;
  return (
    <Drawer.Backdrop isOpen={item !== null} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-lg">
          <Drawer.CloseTrigger />
          {item ? (
            <>
              <Drawer.Header className="flex flex-col items-start gap-1">
                {item.at ? <p className="text-xs text-muted tabular-nums">{formatTime(item.at)}</p> : null}
                <Drawer.Heading className="pr-8 text-base font-semibold">
                  {headline(item, detail, vault)}
                </Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                <DetailBody item={item} />
              </Drawer.Body>
            </>
          ) : null}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

/** Loading, failure and empty states of an activity source, in one place. */
export function ActivityState({
  isPending,
  error,
  onRetry,
  empty,
  emptyText,
}: {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  empty: boolean;
  emptyText: string;
}) {
  if (isPending)
    return (
      <div className="p-3">
        <LoadingRows rows={5} label="Đang tải hoạt động" />
      </div>
    );
  if (error && empty)
    return (
      <div className="p-3">
        <ErrorBox title="Không tải được hoạt động" detail={errorText(error)} onRetry={onRetry} />
      </div>
    );
  if (empty) return <p className="px-4 py-10 text-center text-sm text-muted">{emptyText}</p>;
  return null;
}
