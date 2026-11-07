// One Guardian check as a card. The explanation is rendered as plain text (React escapes it).
import type { CheckListRow } from "@/lib/types";
import { formatTime, shortHex } from "@/lib/format";
import { ENDPOINT_LABEL } from "@/lib/labels";
import { RiskBadge, RuleChips, TxLink } from "./ui";

export function CheckCard({ c }: { c: CheckListRow }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RiskBadge risk={c.risk} score={c.score} />
        <span className="font-mono text-xs text-muted">{ENDPOINT_LABEL[c.endpoint] ?? c.endpoint}</span>
        <time className="text-xs text-muted" dateTime={new Date(c.createdAt).toISOString()}>
          {formatTime(c.createdAt)}
        </time>
        {c.demo ? <span className="rounded bg-demo-bg px-1.5 text-xs text-demo">DEMO</span> : null}
      </div>
      <RuleChips ids={c.ruleIds} />
      {c.explanation ? (
        <p className="max-w-[75ch] text-sm leading-relaxed whitespace-pre-line">{c.explanation.vi}</p>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          checkId <span className="font-mono">{shortHex(c.checkId, 10, 6)}</span>
        </span>
        <span>{c.latencyMs} ms</span>
        {c.explanation ? (
          <span>giải thích: {c.explanation.source === "llm" ? "LLM" : "mẫu cố định"}</span>
        ) : null}
        {c.paymentTx ? (
          <span>
            phí x402: <TxLink hash={c.paymentTx} />
          </span>
        ) : null}
      </p>
    </li>
  );
}
