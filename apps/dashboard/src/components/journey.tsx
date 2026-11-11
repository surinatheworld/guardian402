"use client";
// "Hành trình giao dịch": every transaction as three stops, Agent đề xuất → Guardian kiểm tra → Két quyết định.
// The Guardian's verdict and the vault's execution are separate stops, so a verdict never reads as "done".
import {
  ChevronRight,
  CircleCheckFill,
  CircleDashed,
  CircleInfoFill,
  CircleXmarkFill,
  TriangleExclamationFill,
} from "@gravity-ui/icons";
import { Spinner } from "@heroui/react/spinner";
import type { ReactNode } from "react";
import { summarizeDiff, type ActivityItem } from "@/lib/activity";
import type { CheckDetail } from "@/lib/activity-hooks";
import { vaultDecision } from "@/lib/check-calls";
import { knownName, tokenMeta } from "@/lib/config";
import { revertLabel } from "@/lib/labels";
import { scenarioTitle } from "@/lib/scenarios";
import { RiskBadge, TxLink } from "./ui";

export type StopTone = "ok" | "bad" | "warn" | "info" | "neutral" | "active" | "waiting";
export type Stop = { label: string; value: ReactNode; sub?: ReactNode; tone: StopTone };

const ICON: Record<StopTone, ReactNode> = {
  ok: <CircleCheckFill aria-hidden="true" className="size-4 text-success" />,
  bad: <CircleXmarkFill aria-hidden="true" className="size-4 text-danger" />,
  warn: <TriangleExclamationFill aria-hidden="true" className="size-4 text-warning" />,
  info: <CircleInfoFill aria-hidden="true" className="size-4 text-accent" />,
  neutral: <CircleInfoFill aria-hidden="true" className="size-4 text-muted" />,
  active: <Spinner size="sm" color="accent" />,
  waiting: <CircleDashed aria-hidden="true" className="size-4 text-muted" />,
};

/**
 * The stops side by side when there is room (a container query, so the same journey fits a full-width row,
 * a half-width result card and a narrow drawer), stacked otherwise.
 */
export function Journey({ stops, compact = false }: { stops: Stop[]; compact?: boolean }) {
  const row =
    stops.length === 2
      ? "@md:grid-cols-[1fr_auto_1fr] @md:gap-x-3"
      : "@xl:grid-cols-[1fr_auto_1fr_auto_1fr] @xl:gap-x-3";
  const arrow = stops.length === 2 ? "@md:block" : "@xl:block";
  return (
    <div className="@container">
      <ol aria-label="Hành trình giao dịch" className={`grid grid-cols-1 gap-3 ${row}`}>
        {stops.map((s, i) => (
          <li key={s.label} className="contents">
            <div className={`flex min-w-0 gap-2.5 ${s.tone === "waiting" ? "opacity-60" : ""}`}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{ICON[s.tone]}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium text-muted">{s.label}</span>
                <span className={`min-w-0 break-words ${compact ? "text-sm" : "text-sm font-medium"}`}>
                  {s.value}
                </span>
                {s.sub ? <span className="min-w-0 break-words text-xs text-muted">{s.sub}</span> : null}
              </div>
            </div>
            {i < stops.length - 1 ? (
              <ChevronRight aria-hidden="true" className={`hidden size-4 self-center text-muted ${arrow}`} />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What the agent proposed, in words, from the simulated money flow (or the scenario, or the execution). */
export function proposalText(item: ActivityItem, detail: CheckDetail | undefined, vault: string): string {
  if (detail) return summarizeDiff(detail.diff, vault, knownName, tokenMeta);
  if (item.attempt) return scenarioTitle(item.attempt.scenario);
  if (item.check) return "Đang đọc nội dung giao dịch…";
  return "Giao dịch dưới ngưỡng cần Guardian duyệt";
}

/** The three stops of an activity item. `maxAgentRisk` lets a trial show the vault's predicted decision. */
export function stopsFor(
  item: ActivityItem,
  detail: CheckDetail | undefined,
  vault: string,
  maxAgentRisk?: number,
): Stop[] {
  const proposal: Stop = { label: "Agent đề xuất", value: proposalText(item, detail, vault), tone: "info" };

  const reasons = item.check?.ruleIds.length ?? item.attempt?.guardian?.findings?.length ?? 0;
  const guardian: Stop = item.risk
    ? {
        label: "Guardian kiểm tra",
        value: <RiskBadge risk={item.risk} score={item.check?.score} />,
        sub: reasons ? `${reasons} lý do` : "Không thấy dấu hiệu bất thường",
        tone: item.risk === "HIGH" ? "bad" : item.risk === "MEDIUM" ? "warn" : "ok",
      }
    : item.execution && !item.execution.withVerdict
      ? { label: "Guardian kiểm tra", value: "Không cần duyệt", sub: "Số tiền dưới ngưỡng", tone: "neutral" }
      : { label: "Guardian kiểm tra", value: "Không qua Guardian", tone: "neutral" };

  const o = item.outcome;
  let vaultStop: Stop;
  if (o.kind === "executed")
    vaultStop = {
      label: "Két quyết định",
      value: "Đã thực hiện",
      sub: o.tx ? <TxLink hash={o.tx} label="Xem giao dịch" /> : "Trên mạng khác",
      tone: "ok",
    };
  else if (o.kind === "rejected")
    vaultStop = {
      label: "Két quyết định",
      value: "Đã từ chối",
      sub: o.tx ? (
        <>
          {revertLabel(o.reason)} · <TxLink hash={o.tx} label="giao dịch" />
        </>
      ) : (
        revertLabel(o.reason)
      ),
      tone: "bad",
    };
  else if (o.kind === "trial") {
    const d = detail
      ? vaultDecision(
          {
            findings: detail.findings,
            riskCode: ["LOW", "MEDIUM", "HIGH"].indexOf(detail.risk) as 0 | 1 | 2,
          },
          maxAgentRisk,
        )
      : null;
    vaultStop = {
      label: "Két quyết định (dự đoán)",
      value: d ? (d.blocked ? "Sẽ từ chối" : "Sẽ chấp nhận") : "Chỉ chạy thử",
      sub: d ? d.text : "Không gửi lên chain",
      tone: d ? (d.blocked ? "bad" : "ok") : "neutral",
    };
  } else if (o.kind === "check-only")
    vaultStop = {
      label: "Két quyết định",
      value: "Chưa gửi",
      sub: "Chỉ kiểm tra, Guardian không ký duyệt",
      tone: "neutral",
    };
  else
    vaultStop = {
      label: "Két quyết định",
      value: "Chưa thấy trên két",
      sub: "Agent chưa gửi giao dịch này",
      tone: "neutral",
    };
  return [proposal, guardian, vaultStop];
}
