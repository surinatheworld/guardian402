// Small presentational pieces shared by every page.
import type { ReactNode } from "react";
import type { RiskLevel } from "@guardian402/shared";
import { NETWORK, knownName } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { RISK_LABEL, ruleLabel } from "@/lib/labels";

const SNOWTRACE = "https://testnet.snowtrace.io";

export function PageHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-[65ch] text-muted">{lead}</p>
    </header>
  );
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const riskClass: Record<RiskLevel, string> = {
  LOW: "bg-low-bg text-low border-low/40",
  MEDIUM: "bg-medium-bg text-medium border-medium/40",
  HIGH: "bg-high-bg text-high border-high/40",
};
const riskMark: Record<RiskLevel, string> = { LOW: "●", MEDIUM: "▲", HIGH: "■" };

/** Risk with colour, a shape and a word, so it reads without colour too. */
export function RiskBadge({ risk, score }: { risk: RiskLevel; score?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${riskClass[risk]}`}
    >
      <span aria-hidden="true">{riskMark[risk]}</span>
      Rủi ro {RISK_LABEL[risk]}
      {score !== undefined ? <span className="font-normal opacity-80">· {score}/100</span> : null}
    </span>
  );
}

export function RuleChips({ ids }: { ids: readonly string[] | undefined }) {
  if (!ids?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Luật đã kích hoạt">
      {ids.map((id) => (
        <li key={id} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg" title={id}>
          {ruleLabel(id)}
        </li>
      ))}
    </ul>
  );
}

/** A transaction hash: a Snowtrace link on Fuji, plain text on the local fork (not on any explorer). */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  if (NETWORK !== "fuji") {
    return (
      <span className="font-mono text-xs" title={hash}>
        {label ?? shortHex(hash, 10, 6)} (fork)
      </span>
    );
  }
  return (
    <a
      className="font-mono text-xs text-accent underline underline-offset-2 hover:no-underline"
      href={`${SNOWTRACE}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      title={hash}
    >
      {label ?? shortHex(hash, 10, 6)}
      <span className="sr-only"> (mở trên Snowtrace)</span>
    </a>
  );
}

export function AddressLink({ address }: { address: string }) {
  const name = knownName(address);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <a
        className="font-mono text-xs text-accent underline underline-offset-2 hover:no-underline"
        href={`${SNOWTRACE}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        title={address}
      >
        {shortHex(address)}
        <span className="sr-only"> (mở trên Snowtrace)</span>
      </a>
      {name ? <span className="text-xs text-muted">{name}</span> : null}
    </span>
  );
}

export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-accent" />
      {label}
    </p>
  );
}

export function ErrorBox({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string | undefined;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-high/40 bg-high-bg p-3 text-sm text-high"
    >
      <p className="font-semibold">{title}</p>
      {detail ? <p className="break-words">{detail}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-md border border-high/50 px-2 py-1"
        >
          Thử lại
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-2 p-3">
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

/** A label–value list that stacks on a phone. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
