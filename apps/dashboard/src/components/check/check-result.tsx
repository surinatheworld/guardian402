"use client";
// Result of one Guardian check (blocks 4–7 of the approved wireframe): verdict, triggered rules, the
// explanation and what the simulation changed in the vault. Risk comes from the rule engine only; the
// explanation is shown as text and never decides anything.
import { Chip } from "@heroui/react/chip";
import { Skeleton } from "@heroui/react/skeleton";
import { Tabs } from "@heroui/react/tabs";
import type { CheckResponse, RiskLevel } from "@guardian402/shared";
import type { ReactNode } from "react";
import { AddressLink } from "@/components/ui";
import { vaultDecision } from "@/lib/check-calls";
import { tokenMeta } from "@/lib/config";
import { formatAmount, isUnlimited } from "@/lib/format";
import { RISK_LABEL, ruleLabel } from "@/lib/labels";

export const RISK_CHIP: Record<RiskLevel, "success" | "warning" | "danger"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
};

const signed = (raw: string, decimals: number) =>
  `${BigInt(raw) > 0n ? "+" : ""}${formatAmount(raw, decimals, 6)}`;
const thousands = (raw: string) => BigInt(raw).toLocaleString("vi-VN");

export function CheckResult({ r, maxAgentRisk }: { r: CheckResponse; maxAgentRisk: number | undefined }) {
  const decision = vaultDecision(r, maxAgentRisk);
  const changes: [string, ReactNode][] = [
    ...r.diff.tokenDeltas
      .filter((t) => BigInt(t.delta) !== 0n)
      .map((t): [string, ReactNode] => [
        t.symbol,
        <span className="tabular-nums">{signed(t.delta, t.decimals)}</span>,
      ]),
    ...(BigInt(r.diff.nativeDelta) !== 0n
      ? [
          ["AVAX", <span className="tabular-nums">{signed(r.diff.nativeDelta, 18)}</span>] as [
            string,
            ReactNode,
          ],
        ]
      : []),
    ...r.diff.approvals.map((a): [string, ReactNode] => {
      const m = tokenMeta(a.token);
      return [
        "Cấp quyền",
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          {a.unlimited || isUnlimited(a.amount) ? "Không giới hạn" : formatAmount(a.amount, m.decimals, 6)}{" "}
          {m.symbol} cho <AddressLink address={a.spender} />
        </span>,
      ];
    }),
  ];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="Kết luận">
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={RISK_CHIP[r.risk]} variant="soft" size="lg" className="font-semibold">
            <Chip.Label>
              Rủi ro {RISK_LABEL[r.risk]} · {r.score}/100
            </Chip.Label>
          </Chip>
          <span className="text-xs text-muted tabular-nums">
            {(r.latencyMs / 1000).toLocaleString("vi-VN")} giây
          </span>
        </div>
        <p className="text-base font-semibold text-pretty">{decision.text}</p>
        <p className="text-xs text-muted tabular-nums">
          {r.simulation.success
            ? `Mô phỏng thành công trên fork Fuji · block ${thousands(r.simulation.forkBlock)} · gas ${thousands(r.simulation.gasUsed)}`
            : `Mô phỏng thất bại${r.simulation.revertReason ? `: ${r.simulation.revertReason}` : ""} · block ${thousands(r.simulation.forkBlock)}`}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          Luật đã kích hoạt <span className="font-normal text-muted">{r.findings.length}</span>
        </h3>
        {r.findings.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {r.findings.map((f, i) => (
              <li key={`${f.ruleId}-${i}`} className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {ruleLabel(f.ruleId)}
                  <Chip color={RISK_CHIP[f.severity]} variant="soft" size="sm">
                    <Chip.Label>{RISK_LABEL[f.severity]}</Chip.Label>
                  </Chip>
                </span>
                <span className="text-xs text-muted" lang="en">
                  {f.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Không luật nào kích hoạt.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <Tabs defaultSelectedKey="vi" className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Giải thích</h3>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Ngôn ngữ giải thích">
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
            <p className="max-w-[75ch] leading-relaxed whitespace-pre-line text-pretty">{r.explanation.vi}</p>
          </Tabs.Panel>
          <Tabs.Panel id="en" className="p-0">
            <p lang="en" className="max-w-[75ch] leading-relaxed whitespace-pre-line text-pretty">
              {r.explanation.en}
            </p>
          </Tabs.Panel>
        </Tabs>
        <p className="text-xs text-muted">
          {r.explanation.source === "llm"
            ? "Do LLM viết từ kết quả mô phỏng; mức rủi ro chỉ do bộ luật quyết định."
            : "Câu giải thích lấy từ mẫu cố định; mức rủi ro chỉ do bộ luật quyết định."}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Thay đổi của vault (mô phỏng)</h3>
        {changes.length ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
            {changes.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Số dư và quyền của vault không đổi.</p>
        )}
      </section>
    </div>
  );
}

/** Same shape as CheckResult, for the reveal's skeleton layer. Animated by the reveal's pulse, not its own. */
export function CheckResultSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton animationType="none" className="h-8 w-44 rounded-full" />
        <Skeleton animationType="none" className="h-5 w-4/5 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton animationType="none" className="h-4 w-32 rounded-md" />
        <Skeleton animationType="none" className="h-[58px] w-full rounded-2xl" />
        <Skeleton animationType="none" className="h-[58px] w-full rounded-2xl" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton animationType="none" className="h-4 w-24 rounded-md" />
        <Skeleton animationType="none" className="h-4 w-full rounded-md" />
        <Skeleton animationType="none" className="h-4 w-2/3 rounded-md" />
      </div>
    </div>
  );
}
