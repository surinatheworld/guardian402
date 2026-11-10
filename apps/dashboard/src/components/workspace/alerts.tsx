"use client";
// Cảnh báo tab: alert rules and the notifications they produced (rules are evaluated on each refresh).
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { RULE_IDS } from "@guardian402/shared";
import { ruleLabel } from "@/lib/labels";
import { formatTime } from "@/lib/format";
import { Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { ConfirmInline, Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import { useAlertRules, useInvalidate, useNotifications, wsApi, type AlertRule } from "@/lib/workspace";

const describeRule = (r: AlertRule) =>
  r.kind === "risk"
    ? `Khi Guardian chấm rủi ro từ ${r.minRisk === "HIGH" ? "CAO" : "TRUNG BÌNH"} trở lên`
    : r.kind === "rule"
      ? `Khi luật “${ruleLabel(r.ruleId ?? "")}” kích hoạt`
      : `Khi đã dùng từ ${r.capPercent}% hạn mức USDC trong ngày`;

export function AlertsTab({ vault }: { vault: string }) {
  const n = useNotifications(vault);
  const invalidate = useInvalidate(vault);
  const readAll = useMutation({
    mutationFn: () => wsApi(vault, "notifications/read", "POST", { all: true }),
    onSuccess: () => invalidate("notifications"),
  });
  const readOne = useMutation({
    mutationFn: (id: number) => wsApi(vault, "notifications/read", "POST", { ids: [id] }),
    onSuccess: () => invalidate("notifications"),
  });
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Thông báo"
        actions={
          n.data?.unread ? (
            <Button
              variant="secondary"
              type="button"
              isDisabled={readAll.isPending}
              onPress={() => readAll.mutate()}
            >
              Đánh dấu đã đọc tất cả
            </Button>
          ) : null
        }
      >
        {n.isPending ? (
          <Loading label="Đang đối chiếu các lần kiểm tra của Guardian và hạn mức trên chain…" />
        ) : n.isError ? (
          <ErrorBox
            title="Không đọc được thông báo"
            detail={errorOf(n.error)}
            onRetry={() => void n.refetch()}
          />
        ) : (
          <>
            {!n.data.sync.guardian || !n.data.sync.chain ? (
              <p role="status" className="rounded-lg bg-medium-bg p-3 text-sm text-medium">
                Lần làm mới này chưa đọc được {!n.data.sync.guardian ? "Guardian API" : ""}
                {!n.data.sync.guardian && !n.data.sync.chain ? " và " : ""}
                {!n.data.sync.chain ? "chain" : ""}; thông báo cũ vẫn hiển thị, cảnh báo mới sẽ có khi kết nối
                lại.
              </p>
            ) : null}
            {n.data.notifications.length === 0 ? (
              <Empty>Chưa có thông báo. Thông báo xuất hiện khi một cảnh báo bên dưới khớp.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {n.data.notifications.map((x) => (
                  <li
                    key={x.id}
                    className={`flex flex-wrap items-start justify-between gap-3 rounded-[18px] p-4 ${x.readAt ? "bg-surface-2" : "bg-medium-bg"}`}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-semibold">
                        {x.readAt ? null : <span className="sr-only">Chưa đọc: </span>}
                        {x.title}
                      </span>
                      <span className="text-sm break-words text-muted">{x.body}</span>
                      <span className="text-xs text-muted tabular-nums">{formatTime(x.createdAt)}</span>
                    </div>
                    {x.readAt ? (
                      <Pill>Đã đọc</Pill>
                    ) : (
                      <Button variant="secondary" type="button" onPress={() => readOne.mutate(x.id)}>
                        Đã đọc
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <FormError error={readAll.error ?? readOne.error} />
      </Card>
      <Rules vault={vault} />
    </div>
  );
}

function Rules({ vault }: { vault: string }) {
  const q = useAlertRules(vault);
  const invalidate = useInvalidate(vault);
  const [confirm, setConfirm] = useState<number | null>(null);
  const toggle = useMutation({
    mutationFn: (r: AlertRule) => wsApi(vault, `alert-rules/${r.id}`, "PATCH", { enabled: !r.enabled }),
    onSuccess: () => invalidate("rules"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => wsApi(vault, `alert-rules/${id}`, "DELETE"),
    onSuccess: () => {
      setConfirm(null);
      void invalidate("rules");
    },
  });
  return (
    <>
      <Card title="Cảnh báo">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorBox
            title="Không đọc được cảnh báo"
            detail={errorOf(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : q.data.rules.length === 0 ? (
          <Empty>Chưa có cảnh báo nào.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.rules.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  {r.enabled ? <Pill tone="ok">Đang bật</Pill> : <Pill>Đang tắt</Pill>}
                </div>
                <p className="text-sm text-muted">{describeRule(r)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    isDisabled={toggle.isPending}
                    onPress={() => toggle.mutate(r)}
                  >
                    {r.enabled ? "Tắt" : "Bật"}
                  </Button>
                  {confirm === r.id ? (
                    <ConfirmInline
                      text="Xoá cảnh báo này?"
                      confirmLabel="Xoá"
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(r.id)}
                      onCancel={() => setConfirm(null)}
                    />
                  ) : (
                    <Button variant="secondary" type="button" onPress={() => setConfirm(r.id)}>
                      Xoá
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <FormError error={toggle.error ?? remove.error} />
      </Card>
      <AddRule vault={vault} onAdded={() => invalidate("rules", "notifications")} />
    </>
  );
}

function AddRule({ vault, onAdded }: { vault: string; onAdded: () => void }) {
  const [kind, setKind] = useState<AlertRule["kind"]>("risk");
  const [name, setName] = useState("Rủi ro cao");
  const [minRisk, setMinRisk] = useState<"MEDIUM" | "HIGH">("HIGH");
  const [ruleId, setRuleId] = useState<string>(RULE_IDS[0] ?? "");
  const [capPercent, setCapPercent] = useState("80");
  const add = useMutation({
    mutationFn: () =>
      wsApi(vault, "alert-rules", "POST", {
        name,
        kind,
        ...(kind === "risk"
          ? { minRisk }
          : kind === "rule"
            ? { ruleId }
            : { capPercent: Number(capPercent) }),
      }),
    onSuccess: onAdded,
  });
  return (
    <Card title="Thêm cảnh báo">
      <p className="text-sm text-muted">
        Cảnh báo chỉ xét các lần kiểm tra tạo sau khi bạn thêm nó, và mỗi lần kiểm tra (hoặc mỗi ngày với hạn
        mức) chỉ báo một lần.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="rule-name" label="Tên">
            <input
              id="rule-name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field id="rule-kind" label="Khi nào báo">
            <select
              id="rule-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AlertRule["kind"])}
              className={INPUT}
            >
              <option value="risk">Theo mức rủi ro</option>
              <option value="rule">Theo một luật cụ thể</option>
              <option value="cap_usage">Theo % hạn mức đã dùng</option>
            </select>
          </Field>
          {kind === "risk" ? (
            <Field id="rule-risk" label="Từ mức">
              <select
                id="rule-risk"
                value={minRisk}
                onChange={(e) => setMinRisk(e.target.value as "MEDIUM" | "HIGH")}
                className={INPUT}
              >
                <option value="HIGH">CAO</option>
                <option value="MEDIUM">TRUNG BÌNH trở lên</option>
              </select>
            </Field>
          ) : kind === "rule" ? (
            <Field id="rule-id" label="Luật">
              <select
                id="rule-id"
                value={ruleId}
                onChange={(e) => setRuleId(e.target.value)}
                className={INPUT}
              >
                {RULE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {ruleLabel(id)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id="rule-cap" label="Từ (% hạn mức USDC/ngày)">
              <input
                id="rule-cap"
                inputMode="numeric"
                required
                value={capPercent}
                onChange={(e) => setCapPercent(e.target.value)}
                className={INPUT}
              />
            </Field>
          )}
        </div>
        <FormError error={add.error} />
        <Button variant="primary" type="submit" isDisabled={add.isPending} className="self-start">
          {add.isPending ? "Đang lưu…" : "Thêm cảnh báo"}
        </Button>
      </form>
    </Card>
  );
}
