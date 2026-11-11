"use client";
// Alert settings of a linked vault: the rules that create notifications (checked on each refresh). The
// notifications themselves are in the top bar's bell.
import { Plus, TrashBin } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { NumberField } from "@heroui/react/number-field";
import { Switch } from "@heroui/react/switch";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { RULE_IDS } from "@guardian402/shared";
import { errorOf } from "@/components/form";
import { EditModal } from "@/components/edit-modal";
import { SelectField, TextInput, useConfirm } from "@/components/fields";
import { Card, Empty, ErrorBox, LoadingRows } from "@/components/ui";
import { ruleLabel } from "@/lib/labels";
import { useAlertRules, useInvalidate, wsApi, type AlertRule } from "@/lib/workspace";

const describeRule = (r: AlertRule) =>
  r.kind === "risk"
    ? `Khi Guardian chấm rủi ro ${r.minRisk === "HIGH" ? "cao" : "từ trung bình trở lên"}`
    : r.kind === "rule"
      ? `Khi có lý do “${ruleLabel(r.ruleId ?? "")}”`
      : `Khi agent đã tiêu từ ${r.capPercent}% hạn mức USDC trong ngày`;

export function AlertSettings({ vault }: { vault: string }) {
  const q = useAlertRules(vault);
  const invalidate = useInvalidate(vault);
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const toggle = useMutation({
    mutationFn: (r: AlertRule) => wsApi(vault, `alert-rules/${r.id}`, "PATCH", { enabled: !r.enabled }),
    onSuccess: (_d, r) => {
      void invalidate("rules");
      toast(r.enabled ? `Đã tắt “${r.name}”` : `Đã bật “${r.name}”`);
    },
    onError: (e) => toast.danger("Chưa đổi được cảnh báo", { description: errorOf(e) }),
  });
  return (
    <Card
      title="Cảnh báo"
      description="Khi nào dashboard báo cho bạn ở biểu tượng chuông"
      actions={
        <Button size="sm" variant="secondary" onPress={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Thêm cảnh báo
        </Button>
      }
    >
      {q.isPending ? (
        <LoadingRows rows={2} />
      ) : q.isError ? (
        <ErrorBox
          title="Không đọc được cảnh báo"
          detail={errorOf(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.rules.length === 0 ? (
        <Empty>Chưa có cảnh báo nào.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-separator">
          {q.data.rules.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <Switch
                isSelected={r.enabled}
                isDisabled={toggle.isPending}
                onChange={() => toggle.mutate(r)}
                className="min-w-0"
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label>{r.name}</Label>
                  <Description>{describeRule(r)}</Description>
                </Switch.Content>
              </Switch>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={`Xoá cảnh báo ${r.name}`}
                onPress={() =>
                  confirm.ask({
                    title: `Xoá cảnh báo “${r.name}”?`,
                    body: "Thông báo cũ vẫn giữ; cảnh báo này sẽ không báo nữa.",
                    confirmLabel: "Xoá cảnh báo",
                    onConfirm: async () => {
                      await wsApi(vault, `alert-rules/${r.id}`, "DELETE");
                      await invalidate("rules");
                      toast(`Đã xoá “${r.name}”`);
                    },
                  })
                }
              >
                <TrashBin aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddRule
        vault={vault}
        isOpen={adding}
        onOpenChange={setAdding}
        onAdded={() => invalidate("rules", "notifications")}
      />
      {confirm.dialog}
    </Card>
  );
}

function AddRule({
  vault,
  isOpen,
  onOpenChange,
  onAdded,
}: {
  vault: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<AlertRule["kind"]>("risk");
  const [name, setName] = useState("Rủi ro cao");
  const [minRisk, setMinRisk] = useState<"MEDIUM" | "HIGH">("HIGH");
  const [ruleId, setRuleId] = useState<string>(RULE_IDS[0] ?? "");
  const [capPercent, setCapPercent] = useState(80);
  const add = useMutation({
    mutationFn: () =>
      wsApi(vault, "alert-rules", "POST", {
        name,
        kind,
        ...(kind === "risk" ? { minRisk } : kind === "rule" ? { ruleId } : { capPercent }),
      }),
    onSuccess: () => {
      onAdded();
      onOpenChange(false);
      toast.success(`Đã thêm cảnh báo “${name}”`, {
        description: "Áp dụng cho các lần kiểm tra từ bây giờ.",
      });
    },
  });
  return (
    <EditModal
      isOpen={isOpen}
      onOpenChange={(o) => {
        add.reset();
        onOpenChange(o);
      }}
      title="Thêm cảnh báo"
      submitLabel={add.isPending ? "Đang lưu…" : "Thêm cảnh báo"}
      isSubmitDisabled={add.isPending || !name.trim()}
      onSubmit={() => add.mutate()}
    >
      <TextInput label="Tên" value={name} onChange={setName} isRequired maxLength={60} />
      <SelectField
        label="Báo khi"
        value={kind}
        onChange={setKind}
        options={[
          { id: "risk", label: "Guardian chấm rủi ro cao" },
          { id: "rule", label: "Có một lý do cụ thể" },
          { id: "cap_usage", label: "Agent tiêu gần hết hạn mức" },
        ]}
      />
      {kind === "risk" ? (
        <SelectField
          label="Từ mức"
          value={minRisk}
          onChange={setMinRisk}
          options={[
            { id: "HIGH", label: "Rủi ro cao" },
            { id: "MEDIUM", label: "Từ rủi ro trung bình" },
          ]}
        />
      ) : kind === "rule" ? (
        <SelectField
          label="Lý do"
          value={ruleId}
          onChange={setRuleId}
          options={RULE_IDS.map((id) => ({ id, label: ruleLabel(id) }))}
        />
      ) : (
        <NumberField value={capPercent} onChange={setCapPercent} minValue={1} maxValue={100} step={5}>
          <Label>Từ (% hạn mức USDC mỗi ngày)</Label>
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input className="tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
      )}
      {add.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorOf(add.error)}
        </p>
      ) : null}
    </EditModal>
  );
}
