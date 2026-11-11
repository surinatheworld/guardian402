"use client";
// Fields of the rule-set builder, as HeroUI parts with their own styles.
import { Checkbox } from "@heroui/react/checkbox";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import type { ComponentProps, ReactNode } from "react";
import { Field } from "@/components/form";

export function PolicyInput({
  id,
  label,
  hint,
  className = "",
  ...props
}: ComponentProps<typeof Input> & { id: string; label: string; hint?: string; className?: string }) {
  return (
    <Field id={id} label={label}>
      <Input
        {...props}
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`w-full ${className}`}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </span>
      ) : null}
    </Field>
  );
}

export function PolicySelect({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "Chọn…",
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      className="min-w-0"
      isDisabled={disabled ?? false}
      placeholder={placeholder}
      value={value || null}
      onChange={(key) => onChange(key === null ? "" : String(key))}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value className="min-w-0 truncate" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              <span className="min-w-0 wrap-anywhere">{option.label}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function PolicyCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (selected: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Checkbox isSelected={checked} onChange={onChange} className="min-w-0">
      <Checkbox.Content className="min-w-0 py-1.5">
        <Checkbox.Control className="shrink-0">
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Label className="min-w-0 wrap-anywhere">{children}</Label>
      </Checkbox.Content>
    </Checkbox>
  );
}
