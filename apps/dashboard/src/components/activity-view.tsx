"use client";
// The activity list (each row a compact journey) and the detail drawer (the full journey, the money effect,
// the reasons, the explanation, the owner's review and the technical details).
import { Button } from "@heroui/react/button";
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
import { useState } from "react";
import { checkIdOf, moneyEffects, type ActivityItem } from "@/lib/activity";
import { useCheckDetail, useCheckDetails, type CheckDetail } from "@/lib/activity-hooks";
import { errorText } from "@/lib/api";
import { useMe } from "@/lib/account";
import { formatAmount, formatTime } from "@/lib/format";
import { ENDPOINT_LABEL, ENDPOINT_PATH, findingLabel, RISK_TITLE } from "@/lib/labels";
import { scenarioTitle } from "@/lib/scenarios";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import { REVIEW_LABEL, useInvalidate, useWorkspaceChecks, wsApi, type ReviewStatus } from "@/lib/workspace";
import { Journey, proposalText, stopsFor } from "./journey";
import { ErrorBox, LoadingRows, RiskBadge, TechDetails, TxLink } from "./ui";

/** The headline of an item: what happened, in one line. */
function headline(item: ActivityItem, detail: CheckDetail | undefined, vault: string) {
  if (item.attempt) return scenarioTitle(item.attempt.scenario);
  return proposalText(item, detail, vault);
}

export function ActivityList({
  items,
  label,
  onOpen,
}: {
  items: ActivityItem[];
  label: string;
  onOpen: (item: ActivityItem) => void;
}) {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const details = useCheckDetails(items.flatMap((i) => (i.check ? [i.check.checkId] : [])));
  return (
    <ListBox
      aria-label={label}
      selectionMode="none"
      onAction={(key) => {
        const item = items.find((i) => i.id === key);
        if (item) onOpen(item);
      }}
      className="flex flex-col gap-1 p-0"
    >
      {items.map((item) => {
        const detail = item.check ? details.get(item.check.checkId) : undefined;
        const title = headline(item, detail, vault);
        return (
          <ListBox.Item
            key={item.id}
            id={item.id}
            textValue={title}
            className="flex flex-col items-stretch gap-3 rounded-xl px-3 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 text-sm font-medium break-words">{title}</span>
              <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
                {item.outcome.kind === "trial" ? (
                  <Chip size="sm" variant="secondary">
                    Chạy thử
                  </Chip>
                ) : null}
                {item.attempt?.mode === "scripted-attack" ? (
                  <Chip size="sm" variant="secondary">
                    Tấn công mô phỏng
                  </Chip>
                ) : null}
                {item.at ? formatTime(item.at) : ""}
              </span>
            </div>
            <Journey compact stops={stopsFor(item, detail, vault, policy.data?.maxAgentRisk).slice(1)} />
          </ListBox.Item>
        );
      })}
    </ListBox>
  );
}

function Money({ detail }: { detail: CheckDetail }) {
  const lines = moneyEffects(detail.diff);
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl bg-surface-secondary px-4 py-3 text-sm">
      <span className="text-muted">
        {detail.endpoint === "demo" ? "Nếu chạy, két sẽ" : "Theo mô phỏng, két"}
      </span>
      {lines.length ? (
        lines.map((l) => (
          <span
            key={l.symbol}
            className={`font-semibold tabular-nums ${l.raw < 0n ? "text-danger" : "text-success-soft-foreground"}`}
          >
            {l.raw > 0n ? "+" : "−"}
            {formatAmount(l.raw < 0n ? -l.raw : l.raw, l.decimals, 6)} {l.symbol}
          </span>
        ))
      ) : (
        <span className="font-medium">không đổi số dư</span>
      )}
    </div>
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
    <section className="flex flex-col gap-3" aria-labelledby="review-h">
      <h3 id="review-h" className="text-sm font-semibold">
        Đánh giá của bạn
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Select
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
          <Input placeholder="Ví dụ: đã chặn ví này ở sàn" />
        </TextField>
      </div>
      <Description className="text-xs text-muted">
        Ghi chú cho riêng bạn; không đổi mức rủi ro và không đổi gì trên chain.
      </Description>
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        isPending={save.isPending}
        onPress={() => save.mutate()}
      >
        Lưu đánh giá
      </Button>
    </section>
  );
}

export function DetailBody({ item }: { item: ActivityItem }) {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const checkId = checkIdOf(item);
  const q = useCheckDetail(checkId);
  const detail = q.data;
  const findings = detail?.findings ?? [];
  const explanation = detail?.explanation ?? item.check?.explanation ?? null;
  const o = item.outcome;
  return (
    <div className="flex flex-col gap-6">
      <Journey stops={stopsFor(item, detail, vault, policy.data?.maxAgentRisk)} />
      {q.isPending && checkId ? <LoadingRows rows={2} label="Đang đọc kết quả kiểm tra" /> : null}
      {q.isError ? (
        <ErrorBox
          title="Không đọc được kết quả kiểm tra"
          detail={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : null}
      {detail ? <Money detail={detail} /> : null}

      {findings.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="reasons-h">
          <h3 id="reasons-h" className="text-sm font-semibold">
            Lý do
          </h3>
          <ul className="flex flex-col gap-2">
            {findings.map((f, i) => (
              <li key={`${f.ruleId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <RiskBadge risk={f.severity} />
                <span>{findingLabel(f)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {explanation ? (
        <section className="flex flex-col gap-2" aria-labelledby="explain-h">
          <Tabs defaultSelectedKey="vi" className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="explain-h" className="text-sm font-semibold">
                Giải thích
              </h3>
              <Tabs.ListContainer>
                <Tabs.List aria-label="Ngôn ngữ">
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
            </div>
            <Tabs.Panel id="vi" className="p-0">
              <p className="text-sm leading-6 whitespace-pre-line">{explanation.vi}</p>
            </Tabs.Panel>
            <Tabs.Panel id="en" className="p-0">
              <p lang="en" className="text-sm leading-6 whitespace-pre-line">
                {explanation.en}
              </p>
            </Tabs.Panel>
          </Tabs>
          <p className="text-xs text-muted">
            {explanation.source === "llm" ? "Do AI viết từ kết quả chạy thử." : "Lấy từ mẫu cố định."} Mức rủi
            ro chỉ do bộ luật quyết định.
          </p>
        </section>
      ) : null}

      {checkId && item.outcome.kind !== "trial" ? <Review checkId={checkId} /> : null}

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
              <Drawer.Header className="flex flex-col items-start gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {item.check ? (
                    <span>{ENDPOINT_LABEL[item.check.endpoint] ?? item.check.endpoint}</span>
                  ) : null}
                  {item.at ? <span className="tabular-nums">{formatTime(item.at)}</span> : null}
                  {item.risk ? <span className="sr-only">{RISK_TITLE[item.risk]}</span> : null}
                </div>
                <Drawer.Heading className="pr-8 text-lg font-semibold tracking-tight">
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
  if (isPending) return <LoadingRows rows={4} label="Đang tải hoạt động" />;
  if (error && empty)
    return <ErrorBox title="Không tải được hoạt động" detail={errorText(error)} onRetry={onRetry} />;
  if (empty) return <p className="py-2 text-sm text-muted">{emptyText}</p>;
  return null;
}
