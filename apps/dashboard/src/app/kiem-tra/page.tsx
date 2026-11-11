"use client";
// Kiểm tra giao dịch (SPEC §11): pick a scenario, write a USDC transfer or paste calls JSON, and see the
// Guardian result next to the input (approved wireframe: two panels "A", with the scenario list of "C").
// Uses the free /v1/demo/check, which exists only in DEMO mode. Nothing is signed or sent on-chain.
import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Description } from "@heroui/react/description";
import { Disclosure } from "@heroui/react/disclosure";
import { EmptyState } from "@heroui/react/empty-state";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Kbd } from "@heroui/react/kbd";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { NumberField } from "@heroui/react/number-field";
import { Tabs } from "@heroui/react/tabs";
import { TextArea } from "@heroui/react/textarea";
import { TextField } from "@heroui/react/textfield";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Address } from "viem";
import { FUJI_CHAIN_ID, type CheckResponse, type RiskLevel } from "@guardian402/shared";
import { CheckResult, CheckResultSkeleton, RISK_CHIP } from "@/components/check/check-result";
import { Reveal, SwapText, useShake } from "@/components/motion";
import { AddressLink, Card, PageHeader } from "@/components/ui";
import { describeCall, parseCalls, transferCall, type CallJson, type Parsed } from "@/lib/check-calls";
import { errorText, getJson, HttpError, useGuardianHealth } from "@/lib/api";
import { deployment, GUARDIAN_URL, tokenMeta } from "@/lib/config";
import { RISK_LABEL } from "@/lib/labels";
import { PRESETS } from "@/lib/presets";
import { useSelectedVault } from "@/lib/vault-context";
import { useVaultPolicy } from "@/lib/vault";

type Mode = "kich-ban" | "chuyen" | "json";
type Run = { calls: CallJson[]; preset: string | null; label: string; instant: boolean };

const usdcOf = (p: ReturnType<typeof useVaultPolicy>["data"]) =>
  p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase())?.balance ?? 0n;
const knownToken = (a: Address) => {
  const m = tokenMeta(a);
  return m.symbol === "token" ? undefined : m;
};
const toJson = (calls: CallJson[]) => JSON.stringify(calls, null, 2);
const amountText = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 6 }) : "";

export default function CheckPage() {
  const { address: vault } = useSelectedVault();
  const health = useGuardianHealth();
  const policy = useVaultPolicy();
  const [mode, setMode] = useState<Mode>("kich-ban");
  const [presetId, setPresetId] = useState(PRESETS[0]?.id ?? "S0");
  const [json, setJson] = useState("");
  const [to, setTo] = useState<string>(deployment.deployer);
  const [amount, setAmount] = useState(1.5);
  const [inputError, setInputError] = useState<string | null>(null);
  const [lastRisk, setLastRisk] = useState<Record<string, RiskLevel>>({});
  const [pane, setPane] = useState<"nhap" | "ket-qua">("nhap");
  const [unseen, setUnseen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [jsonRef, shakeJson] = useShake<HTMLTextAreaElement>();
  const [toRef, shakeTo] = useShake<HTMLInputElement>();

  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const presetCalls = useMemo(
    () => (preset ? preset.calls({ ...deployment, vault }, usdcOf(policy.data)) : []),
    [preset, policy.data, vault],
  );

  const run = useMutation({
    mutationFn: (r: Run) =>
      getJson<CheckResponse>(`${GUARDIAN_URL}/v1/demo/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: FUJI_CHAIN_ID, vault, calls: r.calls, lang: "vi" }),
      }),
    onSuccess: (data, r) => {
      if (r.preset) setLastRisk((prev) => ({ ...prev, [r.preset as string]: data.risk }));
      setUnseen(true);
    },
  });

  const currentCalls = (): Parsed<CallJson[]> => {
    if (mode === "kich-ban") return { ok: true, value: presetCalls };
    if (mode === "chuyen") return transferCall(deployment.usdc, 6, to, amountText(amount));
    return parseCalls(json);
  };

  const submit = (instant: boolean) => {
    const calls = currentCalls();
    if (!calls.ok) {
      setInputError(calls.error);
      if (mode === "json") shakeJson();
      if (mode === "chuyen") shakeTo();
      return;
    }
    setInputError(null);
    setPane("ket-qua");
    setUnseen(false);
    run.mutate({
      calls: calls.value,
      preset: mode === "kich-ban" ? presetId : null,
      label: mode === "kich-ban" ? (preset?.id ?? "") : mode === "chuyen" ? "Chuyển USDC" : "JSON",
      instant,
    });
  };

  const switchMode = (next: Mode) => {
    // Opening the JSON editor starts from what the owner was looking at, so a scenario can be edited.
    if (next === "json" && !json.trim()) {
      const from = mode === "chuyen" ? transferCall(deployment.usdc, 6, to, amountText(amount)) : null;
      setJson(toJson(from?.ok ? from.value : presetCalls));
    }
    setInputError(null);
    setMode(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!run.isPending) submit(true);
    }
  };

  const demoOff = health.data && !health.data.demoMode;
  const r = run.data;
  const last = run.variables;
  const httpDetail =
    run.error instanceof HttpError && run.error.status === 400
      ? JSON.stringify((run.error.body as { details?: unknown } | null)?.details ?? run.error.body)
      : null;
  const preview =
    mode === "json" ? null : mode === "kich-ban" ? { ok: true as const, value: presetCalls } : currentCalls();

  return (
    <>
      <PageHeader
        title="Kiểm tra giao dịch"
        lead="Guardian mô phỏng lô lệnh trên fork của Fuji, chấm điểm bằng luật cố định rồi giải thích. Không có gì được ký hay gửi lên chain."
      />
      {demoOff ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Trang này chỉ dùng được ở DEMO MODE</Alert.Title>
            <Alert.Description>
              Guardian đang chạy với DEMO_MODE=false nên không có /v1/demo/check.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="@container flex flex-col gap-4">
        {/* Under ~900px of content the two panels share one column: switch between them. */}
        <Tabs
          className="@4xl:hidden"
          selectedKey={pane}
          onSelectionChange={(key) => {
            setPane(key === "ket-qua" ? "ket-qua" : "nhap");
            if (key === "ket-qua") setUnseen(false);
          }}
        >
          <Tabs.ListContainer className="self-start">
            <Tabs.List aria-label="Khu vực">
              <Tabs.Tab id="nhap" className="whitespace-nowrap">
                Nhập
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="ket-qua" className="whitespace-nowrap">
                Kết quả
                {unseen && pane === "nhap" ? (
                  <span
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-high"
                    aria-label="có kết quả mới"
                  />
                ) : null}
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-2">
          {/* Block 3: input */}
          <div className={pane === "nhap" ? "contents" : "hidden @4xl:contents"} onKeyDown={onKeyDown}>
            <Card title="Lệnh cần kiểm tra">
              <ToggleButtonGroup
                aria-label="Cách nhập"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[mode]}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (next) switchMode(next as Mode);
                }}
                size="sm"
                className="self-start"
              >
                <ToggleButton id="kich-ban">Kịch bản</ToggleButton>
                <ToggleButton id="chuyen">Chuyển USDC</ToggleButton>
                <ToggleButton id="json">JSON</ToggleButton>
              </ToggleButtonGroup>

              {mode === "kich-ban" ? (
                <div className="flex flex-col gap-3">
                  <ListBox
                    aria-label="Kịch bản"
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[presetId]}
                    onSelectionChange={(keys) => {
                      if (keys === "all") return;
                      const next = [...keys][0];
                      if (next) setPresetId(String(next));
                    }}
                    className="flex flex-col gap-1 p-0"
                  >
                    {PRESETS.map((p) => {
                      const risk = lastRisk[p.id];
                      return (
                        <ListBox.Item
                          key={p.id}
                          id={p.id}
                          textValue={p.label}
                          className="flex min-h-[42px] items-start justify-between gap-3 rounded-xl px-3 py-2 data-[selected=true]:bg-surface-2 data-[selected=true]:font-semibold"
                        >
                          <span className="min-w-0 text-sm wrap-anywhere">{p.label}</span>
                          {risk ? (
                            <Chip color={RISK_CHIP[risk]} variant="soft" size="sm" className="shrink-0">
                              <Chip.Label>{RISK_LABEL[risk]}</Chip.Label>
                            </Chip>
                          ) : null}
                        </ListBox.Item>
                      );
                    })}
                  </ListBox>
                </div>
              ) : null}

              {mode === "chuyen" ? (
                <div className="flex flex-col gap-3">
                  <TextField
                    value={to}
                    onChange={(v) => {
                      setTo(v);
                      setInputError(null);
                    }}
                    isInvalid={Boolean(inputError)}
                    className={`t-input-wrap flex flex-col gap-1 ${inputError ? "is-error" : ""}`}
                  >
                    <Label className="text-sm font-medium">Người nhận</Label>
                    <Input
                      ref={toRef}
                      spellCheck={false}
                      className="t-input min-h-[42px] w-full font-mono text-sm"
                    />
                    <Description className="text-xs text-muted">
                      Phải nằm trong danh sách người nhận của vault, nếu không vault sẽ từ chối.
                    </Description>
                    <FieldError className="t-error-msg text-sm">{inputError}</FieldError>
                  </TextField>
                  <NumberField
                    value={amount}
                    onChange={(v) => {
                      setAmount(v);
                      setInputError(null);
                    }}
                    minValue={0}
                    step={0.5}
                    formatOptions={{ maximumFractionDigits: 6 }}
                    className="flex flex-col gap-1"
                  >
                    <Label className="text-sm font-medium">Số tiền (USDC)</Label>
                    <NumberField.Group>
                      <NumberField.DecrementButton aria-label="Giảm" />
                      <NumberField.Input className="min-h-[42px] tabular-nums" />
                      <NumberField.IncrementButton aria-label="Tăng" />
                    </NumberField.Group>
                  </NumberField>
                </div>
              ) : null}

              {mode === "json" ? (
                <TextField
                  value={json}
                  onChange={(v) => {
                    setJson(v);
                    setInputError(null);
                  }}
                  isInvalid={Boolean(inputError)}
                  className={`t-input-wrap flex flex-col gap-1 ${inputError ? "is-error" : ""}`}
                >
                  <Label className="text-sm font-medium">Danh sách lệnh (JSON)</Label>
                  <TextArea
                    ref={jsonRef}
                    rows={10}
                    spellCheck={false}
                    placeholder='[{ "target": "0x…", "value": "0", "data": "0x…" }]'
                    className="t-input w-full font-mono text-xs"
                  />
                  <Description className="text-xs text-muted">
                    Tối đa 8 lệnh, mỗi lệnh {"{ target, value, data }"}; value tính bằng wei.
                  </Description>
                  <FieldError className="t-error-msg text-sm">{inputError}</FieldError>
                </TextField>
              ) : null}

              {preview?.ok && preview.value.length ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
                  <span className="text-xs font-medium text-muted">
                    {preview.value.length} lệnh sẽ gửi tới vault
                  </span>
                  <ul className="flex flex-col gap-1">
                    {preview.value.map((c, i) => (
                      <li key={i} className="font-mono text-xs break-all">
                        {describeCall(c, knownToken)}
                      </li>
                    ))}
                  </ul>
                  {mode === "kich-ban" ? (
                    <Disclosure>
                      <Disclosure.Heading>
                        <Disclosure.Trigger className="flex min-h-[32px] items-center gap-2 text-sm font-medium">
                          Xem JSON
                          <Disclosure.Indicator />
                        </Disclosure.Trigger>
                      </Disclosure.Heading>
                      <Disclosure.Content>
                        <Disclosure.Body className="p-0 pt-2">
                          <pre className="max-h-64 overflow-auto rounded-xl bg-surface p-3 font-mono text-xs break-all whitespace-pre-wrap">
                            {toJson(presetCalls)}
                          </pre>
                          <p className="pt-2 text-xs text-muted">
                            Muốn sửa thì chuyển sang JSON: lệnh này được chép sẵn.
                          </p>
                        </Disclosure.Body>
                      </Disclosure.Content>
                    </Disclosure>
                  ) : null}
                </div>
              ) : null}

              {/* No wrap: the button keeps its row when its label grows to "Đang kiểm tra…"; the note wraps instead. */}
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
                <span className="inline-flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-xs text-muted">
                  Vault <AddressLink address={vault} /> · không ký, không gửi lên chain
                </span>
                <Button
                  variant="primary"
                  type="button"
                  className="shrink-0"
                  isDisabled={run.isPending || Boolean(demoOff)}
                  onPress={() => submit(false)}
                >
                  <SwapText text={run.isPending ? "Đang kiểm tra…" : "Kiểm tra"} />
                  <Kbd variant="light" className="ml-1 hidden text-xs sm:inline-flex" aria-hidden="true">
                    {isMac ? <Kbd.Abbr keyValue="command" /> : <Kbd.Content>Ctrl</Kbd.Content>}
                    <Kbd.Abbr keyValue="enter" />
                  </Kbd>
                </Button>
              </div>
            </Card>
          </div>

          {/* Blocks 4–7: result */}
          <div className={pane === "ket-qua" ? "contents" : "hidden @4xl:contents"}>
            <Card
              title="Kết quả"
              actions={
                last && (r || run.isPending) ? <span className="text-xs text-muted">{last.label}</span> : null
              }
            >
              <div aria-live="polite" className="flex flex-col">
                {run.isError ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{httpDetail ? "Yêu cầu không hợp lệ" : "Không kiểm tra được"}</Alert.Title>
                      <Alert.Description className="break-words">
                        {httpDetail ?? errorText(run.error)} Lệnh của bạn vẫn giữ nguyên.
                      </Alert.Description>
                      {last ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          className="mt-2 self-start"
                          onPress={() => run.mutate(last)}
                        >
                          Thử lại
                        </Button>
                      ) : null}
                    </Alert.Content>
                  </Alert>
                ) : run.isPending || r ? (
                  <>
                    {run.isPending ? (
                      <p className="pb-4 text-sm" role="status">
                        <span className="t-shimmer" data-text="Đang mô phỏng trên fork Fuji…">
                          Đang mô phỏng trên fork Fuji…
                        </span>
                      </p>
                    ) : null}
                    <Reveal
                      loading={run.isPending}
                      ready={Boolean(r)}
                      instant={Boolean(last?.instant)}
                      skeleton={<CheckResultSkeleton />}
                    >
                      {r ? <CheckResult r={r} maxAgentRisk={policy.data?.maxAgentRisk} /> : null}
                    </Reveal>
                  </>
                ) : (
                  <EmptyState className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <p className="max-w-[36ch] text-sm text-muted">
                      Chọn kịch bản hoặc soạn lệnh, rồi bấm Kiểm tra. Kết quả hiện ở đây.
                    </p>
                  </EmptyState>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
