"use client";
// Form fields and the destructive confirmation, as plain compositions of HeroUI parts (no style overrides).
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { TextField } from "@heroui/react/textfield";
import { useState, type ReactNode } from "react";

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  description,
  isDisabled = false,
  className = "",
}: {
  label: string;
  value: T;
  options: { id: T; label: string; description?: string }[];
  onChange: (value: T) => void;
  description?: ReactNode;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      variant="secondary"
      className={`min-w-0 ${className}`}
      value={value}
      isDisabled={isDisabled}
      onChange={(key) => key !== null && onChange(String(key) as T)}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value className="min-w-0 truncate" />
        <Select.Indicator />
      </Select.Trigger>
      {description ? <Description>{description}</Description> : null}
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              <div className="flex min-w-0 flex-col">
                <Label>{o.label}</Label>
                {o.description ? <Description>{o.description}</Description> : null}
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  description,
  error,
  placeholder,
  isRequired = false,
  maxLength,
  mono = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: ReactNode;
  error?: string | null | undefined;
  placeholder?: string;
  isRequired?: boolean;
  maxLength?: number;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isInvalid={Boolean(error)}
      {...(maxLength ? { maxLength } : {})}
      autoFocus={autoFocus}
      className="min-w-0"
    >
      <Label>{label}</Label>
      <Input
        variant="secondary"
        {...(placeholder ? { placeholder } : {})}
        {...(mono ? { spellCheck: false, className: "font-mono" } : {})}
      />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{error}</FieldError>
    </TextField>
  );
}

/** "Are you sure?" for destructive actions: `ask(...)` opens it; render `dialog` once. */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    body: ReactNode;
    confirmLabel: string;
    onConfirm: () => Promise<unknown>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = (
    <AlertDialog.Backdrop isOpen={state !== null} onOpenChange={(o) => !o && !busy && setState(null)}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-md">
          {state ? (
            <>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>{state.title}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <div className="text-sm">{state.body}</div>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary" isDisabled={busy}>
                  Huỷ
                </Button>
                <Button
                  variant="danger"
                  isPending={busy}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await state.onConfirm();
                      setState(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {state.confirmLabel}
                </Button>
              </AlertDialog.Footer>
            </>
          ) : null}
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
  return { ask: setState, dialog };
}
