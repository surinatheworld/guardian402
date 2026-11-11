// Form pieces shared by the account and workspace pages: labelled fields at the 42px control height of
// DESIGN.md, an inline error, and an inline confirmation for destructive actions.
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import type { ReactNode } from "react";

export const INPUT = "min-h-[42px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-high">
      {errorOf(error)}
    </p>
  );
}

/** "Are you sure?" in place, instead of a browser dialog. */
export function ConfirmInline({
  text,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Xác nhận">
      <span>{text}</span>
      <Button variant="danger-soft" type="button" isDisabled={pending === true} onPress={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="secondary" type="button" onPress={onCancel}>
        Huỷ
      </Button>
    </div>
  );
}

/** A small pill for a state that is also spelled out in words (never colour alone). */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "high";
  children: ReactNode;
}) {
  const color = {
    neutral: "default",
    ok: "success",
    warn: "warning",
    high: "danger",
  } as const;
  return (
    <Chip color={color[tone]} variant="soft" size="sm" className="max-w-full font-semibold">
      <Chip.Label className="whitespace-normal break-words">{children}</Chip.Label>
    </Chip>
  );
}
