"use client";
// Form helpers kept for the rule-set builder: a labelled field, an inline error, the destructive confirmation
// (an AlertDialog while it is rendered) and a status chip that always carries a word.
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Label } from "@heroui/react/label";
import type { ReactNode } from "react";

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
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {errorOf(error)}
    </p>
  );
}

/** "Are you sure?" for a destructive action: rendered only while confirming, as an AlertDialog. */
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
    <AlertDialog.Backdrop isOpen onOpenChange={(open) => !open && !pending && onCancel()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-md">
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{text}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={pending === true}>
              Huỷ
            </Button>
            <Button variant="danger" isPending={pending === true} onPress={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

/** A small status chip that is also spelled out in words (never colour alone). */
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
    <Chip color={color[tone]} variant="soft" size="sm" className="max-w-full">
      <Chip.Label className="whitespace-normal break-words">{children}</Chip.Label>
    </Chip>
  );
}
