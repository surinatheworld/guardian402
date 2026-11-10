"use client";
// Kiểm tra tab: the vault's recent Guardian checks and the owner's review of each. A review is the owner's note;
// it never changes the Guardian's risk or anything on chain.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ENDPOINT_LABEL } from "@/lib/labels";
import { formatTime, shortHex } from "@/lib/format";
import { Card, Empty, ErrorBox, Loading, RiskBadge, RuleChips } from "@/components/ui";
import { Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import {
  REVIEW_LABEL,
  useInvalidate,
  useWorkspaceChecks,
  wsApi,
  type ReviewStatus,
  type WorkspaceCheck,
} from "@/lib/workspace";

export function ChecksTab({ vault }: { vault: string }) {
  const q = useWorkspaceChecks(vault);
  const invalidate = useInvalidate(vault);
  return (
    <Card title="Các lần Guardian kiểm tra vault này">
      <p className="text-sm text-muted">
        Đánh dấu từng lần kiểm tra là đã xem, báo động nhầm hoặc cần xử lý. Đây là ghi chú của bạn: không đổi
        mức rủi ro Guardian đã chấm và không đổi gì trên chain.
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBox
          title="Không đọc được các lần kiểm tra"
          detail={errorOf(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.checks.length === 0 ? (
        <Empty>Guardian chưa kiểm tra giao dịch nào của vault này.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.checks.map((c) => (
            <CheckItem key={c.checkId} vault={vault} check={c} onChanged={() => invalidate("checks")} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CheckItem({
  vault,
  check,
  onChanged,
}: {
  vault: string;
  check: WorkspaceCheck;
  onChanged: () => void;
}) {
  const options = (Object.keys(REVIEW_LABEL) as ReviewStatus[]).filter(
    (s) => s !== "false_positive" || check.risk !== "LOW",
  );
  const [status, setStatus] = useState<ReviewStatus>(check.review?.status ?? "reviewed");
  const [note, setNote] = useState(check.review?.note ?? "");
  const save = useMutation({
    mutationFn: () => wsApi(vault, `checks/${check.checkId}/review`, "PUT", { status, note }),
    onSuccess: onChanged,
  });
  const clear = useMutation({
    mutationFn: () => wsApi(vault, `checks/${check.checkId}/review`, "DELETE"),
    onSuccess: onChanged,
  });
  const reviewTone =
    check.review?.status === "escalated" ? "high" : check.review?.status === "false_positive" ? "warn" : "ok";
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={check.risk} score={check.score} />
        <span className="font-mono text-xs text-muted">
          {ENDPOINT_LABEL[check.endpoint] ?? check.endpoint}
        </span>
        <span className="text-xs text-muted tabular-nums">{formatTime(check.createdAt)}</span>
        <span className="font-mono text-xs text-muted" title={check.checkId}>
          {shortHex(check.checkId, 10, 6)}
        </span>
        {check.review ? (
          <Pill tone={reviewTone}>{REVIEW_LABEL[check.review.status]}</Pill>
        ) : (
          <Pill>Chưa đánh giá</Pill>
        )}
      </div>
      <RuleChips ids={check.ruleIds} />
      {check.explanation ? <p className="text-sm">{check.explanation.vi}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto_auto]"
      >
        <Field id={`review-status-${check.checkId}`} label="Đánh giá">
          <select
            id={`review-status-${check.checkId}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ReviewStatus)}
            className={INPUT}
          >
            {options.map((s) => (
              <option key={s} value={s}>
                {REVIEW_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`review-note-${check.checkId}`} label="Ghi chú">
          <input
            id={`review-note-${check.checkId}`}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Button variant="primary" type="submit" isDisabled={save.isPending}>
          Lưu
        </Button>
        {check.review ? (
          <Button
            variant="secondary"
            type="button"
            isDisabled={clear.isPending}
            onPress={() => clear.mutate()}
          >
            Bỏ đánh giá
          </Button>
        ) : null}
      </form>
      <FormError error={save.error ?? clear.error} />
    </li>
  );
}
