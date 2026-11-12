"use client";
// Small presentational pieces shared by every page, composed from HeroUI parts with the default theme tokens.
// One pattern per behaviour: risk is always RiskBadge, a failure is always ErrorBox (Alert), a load is always
// Loading, protocol detail is always TechDetails.
import {
  ArrowUpRightFromSquare,
  CircleCheckFill,
  ShieldExclamation,
  TriangleExclamationFill,
} from "@gravity-ui/icons";
import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Card as HeroCard } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Disclosure } from "@heroui/react/disclosure";
import { EmptyState } from "@heroui/react/empty-state";
import { Link } from "@heroui/react/link";
import { Skeleton } from "@heroui/react/skeleton";
import { Spinner } from "@heroui/react/spinner";
import { Tooltip } from "@heroui/react/tooltip";
import type { ReactNode } from "react";
import type { RiskLevel } from "@guardian402/shared";
import { NETWORK, knownName } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { RISK_TITLE, ruleLabel } from "@/lib/labels";

const SNOWTRACE = "https://testnet.snowtrace.io";

/** Page title, with an optional one-line context and actions on the right. No explanatory lead. */
export function PageHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {children ? <div className="text-sm text-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled surface. Title is a short noun; the description, when present, is one line. */
export function Card({
  title,
  description,
  children,
  actions,
  className = "",
  variant,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: "default" | "secondary" | "tertiary" | "transparent";
}) {
  return (
    <HeroCard variant={variant ?? "default"} className={`min-w-0 ${className}`}>
      {title || actions ? (
        <HeroCard.Header className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <HeroCard.Title className="text-base font-semibold tracking-tight">{title}</HeroCard.Title>
            ) : null}
            {description ? (
              <HeroCard.Description className="text-sm text-muted">{description}</HeroCard.Description>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </HeroCard.Header>
      ) : null}
      <HeroCard.Content className="flex min-w-0 flex-col gap-4">{children}</HeroCard.Content>
    </HeroCard>
  );
}

const riskColor: Record<RiskLevel, "success" | "warning" | "danger"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
};
export const RISK_CHIP = riskColor;
const RiskIcon = ({ risk }: { risk: RiskLevel }) =>
  risk === "LOW" ? (
    <CircleCheckFill aria-hidden="true" className="size-3.5" />
  ) : risk === "MEDIUM" ? (
    <TriangleExclamationFill aria-hidden="true" className="size-3.5" />
  ) : (
    <ShieldExclamation aria-hidden="true" className="size-3.5" />
  );

/** The one way risk is shown: colour, icon and word ("Rủi ro cao"), optionally the score. */
export function RiskBadge({
  risk,
  score,
  size = "sm",
}: {
  risk: RiskLevel;
  score?: number | undefined;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Chip color={riskColor[risk]} variant="soft" size={size} className="max-w-full shrink-0 font-medium">
      <RiskIcon risk={risk} />
      <Chip.Label className="tabular-nums">
        {RISK_TITLE[risk]}
        {score !== undefined ? ` · ${score}/100` : ""}
      </Chip.Label>
    </Chip>
  );
}

/** Names of the rules that fired, in words. The rule ids are in the technical details. */
export function RuleChips({ ids }: { ids: readonly string[] | undefined }) {
  if (!ids?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Lý do">
      {ids.map((id) => (
        <li key={id} className="max-w-full">
          <Chip variant="secondary" size="sm" className="max-w-full">
            <Chip.Label className="whitespace-normal break-words">{ruleLabel(id)}</Chip.Label>
          </Chip>
        </li>
      ))}
    </ul>
  );
}

/** A transaction: a Snowtrace link on Fuji; on the local fork it exists on no explorer, so plain text. */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  if (NETWORK !== "fuji") {
    return (
      <span className="font-mono text-xs text-muted" title={hash}>
        {label ?? shortHex(hash, 8, 6)} · trên fork
      </span>
    );
  }
  return (
    <Link
      href={`${SNOWTRACE}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm"
    >
      <span className={label ? "" : "font-mono text-xs"} title={hash}>
        {label ?? shortHex(hash, 8, 6)}
      </span>
      <ArrowUpRightFromSquare aria-hidden="true" className="size-3" />
      <span className="sr-only"> (mở trên Snowtrace)</span>
    </Link>
  );
}

/** An address: the known name first (if any), then the short address; a Snowtrace link on Fuji. */
export function AddressLink({ address, name }: { address: string; name?: string | undefined }) {
  const label = name ?? knownName(address);
  const short = (
    <span className="font-mono text-xs" title={address}>
      {shortHex(address)}
    </span>
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      {label ? <span className="text-sm">{label}</span> : null}
      {NETWORK === "fuji" ? (
        <Link
          href={`${SNOWTRACE}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted"
        >
          {short}
          <span className="sr-only"> (mở trên Snowtrace)</span>
        </Link>
      ) : (
        <span className="text-muted">{short}</span>
      )}
    </span>
  );
}

/** Waiting for data: a spinner and what is being read. Use LoadingRows where the shape is known. */
export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <Spinner size="sm" color="current" />
      {label}
    </p>
  );
}

/** Skeleton rows in the shape of a list that is loading. */
export function LoadingRows({ rows = 3, label = "Đang tải" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-4 flex-1 rounded-md" />
          <Skeleton className="h-4 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A failure: what went wrong and, when possible, a retry. */
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
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {detail ? <Alert.Description className="break-words">{detail}</Alert.Description> : null}
        {onRetry ? (
          <Button variant="secondary" size="sm" className="mt-2 self-start" onPress={onRetry}>
            Thử lại
          </Button>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}

/** Nothing to show yet, and what to do about it. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <EmptyState className="flex flex-col items-start gap-3 rounded-xl bg-surface-secondary p-4">
      <div className="text-sm text-muted">{children}</div>
      {action}
    </EmptyState>
  );
}

/** A figure with its label, for summary rows. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

/** A label–value list that stacks on a phone. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Protocol detail (hashes, ids, calls) one click away, so the first layer stays in the owner's words. */
export function TechDetails({
  children,
  label = "Chi tiết kỹ thuật",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex min-h-9 items-center gap-1.5 text-sm font-medium text-muted">
          {label}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="flex flex-col gap-2 px-0 pt-1 pb-0 text-xs text-muted">
          {children}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

/** More content one click away (a list, history, an optional form). */
export function Expand({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex min-h-10 items-center gap-1.5 text-sm font-medium">
          {label}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="flex flex-col gap-3 px-0 pt-1 pb-2">{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

/** A term with a short explanation on hover or focus, instead of a paragraph on the page. */
export function Term({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-muted decoration-dotted underline-offset-4"
        >
          {children}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-72 text-sm">{tip}</Tooltip.Content>
    </Tooltip>
  );
}

/** A notice that stays on the page while the condition holds. */
export function Notice({
  status = "default",
  title,
  children,
  action,
}: {
  status?: "default" | "accent" | "success" | "warning" | "danger";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Alert status={status}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children ? <Alert.Description>{children}</Alert.Description> : null}
        {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
      </Alert.Content>
    </Alert>
  );
}
