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
import { knownName, tokenMeta } from "@/lib/config";
import { scenarioTitle } from "@/lib/scenarios";

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
                {s.sub ? <span className="min-w-0 break-words text-sm text-muted">{s.sub}</span> : null}
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
export function proposalText(
  item: ActivityItem,
  detail: CheckDetail | undefined,
  vault: string,
  /** What left the vault, read from the receipt, for an execution without a known check. */
  flows?: string,
): string {
  if (detail) return summarizeDiff(detail.diff, vault, knownName, tokenMeta);
  if (item.attempt) return scenarioTitle(item.attempt.scenario);
  if (item.check) return "Đang đọc nội dung giao dịch…";
  if (flows) return flows;
  if (item.execution?.withVerdict) return "Giao dịch có phê duyệt của Guardian";
  return "Khoản nhỏ két chi thẳng";
}
