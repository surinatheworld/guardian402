import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
// Small presentational pieces shared by every page.
import type { ReactNode } from "react";
import { Card as HeroCard } from "@heroui/react/card";
import type { RiskLevel } from "@guardian402/shared";
import { NETWORK, knownName } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { RISK_LABEL, ruleLabel } from "@/lib/labels";

const SNOWTRACE = "https://testnet.snowtrace.io";

export function PageHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
      <p className="max-w-[65ch] text-sm leading-relaxed text-muted">{lead}</p>
    </header>
  );
}

export function Card({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <HeroCard className={`h3-panel flex min-w-0 flex-col gap-4 ${className}`}>
      {title || actions ? (
        <HeroCard.Header className="flex flex-row flex-wrap items-center justify-between gap-3 p-0">
          {title ? (
            <HeroCard.Title className="text-lg font-bold tracking-tight">{title}</HeroCard.Title>
          ) : (
            <span />
          )}
          {actions}
        </HeroCard.Header>
      ) : null}
      {children}
    </HeroCard>
  );
}

const riskColor: Record<RiskLevel, "success" | "warning" | "danger"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
};
const riskMark: Record<RiskLevel, string> = { LOW: "●", MEDIUM: "▲", HIGH: "■" };

/** Risk with colour, a shape and a word, so it reads without colour too. */
export function RiskBadge({ risk, score }: { risk: RiskLevel; score?: number }) {
  return (
    <Chip color={riskColor[risk]} variant="soft" size="sm" className="max-w-full font-semibold">
      <Chip.Label className="whitespace-normal break-words">
        <span aria-hidden="true" className="mr-1">
          {riskMark[risk]}
        </span>
        Rủi ro {RISK_LABEL[risk]}
        {score !== undefined ? ` · ${score}/100` : ""}
      </Chip.Label>
    </Chip>
  );
}

export function RuleChips({ ids }: { ids: readonly string[] | undefined }) {
  if (!ids?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Luật đã kích hoạt">
      {ids.map((id) => (
        <li key={id} className="max-w-full" title={id}>
          <Chip variant="secondary" size="sm" className="max-w-full">
            <Chip.Label className="whitespace-normal break-words">{ruleLabel(id)}</Chip.Label>
          </Chip>
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
  if (NETWORK === "local") {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="font-mono text-xs" title={address}>
          {shortHex(address)}
        </span>
        {name ? <span className="text-xs text-muted">{name}</span> : null}
      </span>
    );
  }
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
        <Button
          variant="danger-soft"
          type="button"
          onPress={onRetry}
          className="self-start rounded-md border border-high/50 px-2 py-1"
        >
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[20px] bg-surface p-5 shadow-[0_2px_3px_#20273506,0_6px_18px_#2027350a]">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{value}</span>
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
