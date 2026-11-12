"use client";
// Chạy thử: see what the Guardian and the vault do with one transaction. Pick a scenario (or write a USDC
// transfer, or paste calls), then either simulate it for free (DEMO /v1/demo/check, nothing sent) or have the
// demo agent run it for real on the test network (x402 fee + a vault transaction). One page replaces the old
// Kiểm tra giao dịch, Thử demo and the scenario buttons of Điều khiển.
import { Description } from "@heroui/react/description";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { FieldError } from "@heroui/react/field-error";
import { Kbd } from "@heroui/react/kbd";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { NumberField } from "@heroui/react/number-field";
import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { Tabs } from "@heroui/react/tabs";
import { TextArea } from "@heroui/react/textarea";
import { TextField } from "@heroui/react/textfield";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { buttonVariants } from "@heroui/react/button";
import { useMemo, useState, type KeyboardEvent } from "react";
import { FUJI_CHAIN_ID, type CheckResponse } from "@guardian402/shared";
import { DetailBody } from "@/components/activity-view";
import { Journey } from "@/components/journey";
import { TextInput } from "@/components/fields";
import { AddressLink, Card, ErrorBox, Notice, PageHeader, TechDetails } from "@/components/ui";
import { itemFromAttempt, type ActivityItem } from "@/lib/activity";
import { errorText, getJson, HttpError, useAgentHealth, useGuardianHealth } from "@/lib/api";
import { describeCall, parseCalls, transferCall, type CallJson, type Parsed } from "@/lib/check-calls";
import { AGENT_URL, deployment, GUARDIAN_URL, NETWORK, tokenMeta } from "@/lib/config";
import { PAGE } from "@/lib/labels";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import type { Attempt } from "@/lib/types";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";

type Source = "kich-ban" | "chuyen" | "json";
type RunMode = "simulate" | "live";

const amountText = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 6 }) : "";
const knownToken = (a: string) => {
  const m = tokenMeta(a);
  return m.symbol === "token" ? undefined : m;
};

export default function TrialPage() {
  const { address: vault } = useSelectedVault();
  const health = useGuardianHealth();
  const agent = useAgentHealth();
  const policy = useVaultPolicy();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>("kich-ban");
  const [scenarioId, setScenarioId] = useState<Scenario["id"]>("S1");
  const [mode, setMode] = useState<RunMode>("simulate");
  const [to, setTo] = useState<string>(deployment.deployer);
  const [amount, setAmount] = useState(1.5);
  const [json, setJson] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? (SCENARIOS[0] as Scenario);
  const usdcBalance =
    policy.data?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase())?.balance ?? 0n;
  const presetCalls = useMemo(
    () => (scenario.preset ? scenario.preset.calls({ ...deployment, vault }, usdcBalance) : null),
    [scenario, vault, usdcBalance],
  );

  const demoOff = health.data ? !health.data.demoMode : false;
  const isDemoVault = vault.toLowerCase() === deployment.vault.toLowerCase();
  const liveReason = !agent.isSuccess
    ? "Agent demo chưa chạy (pnpm dev:agent)."
    : agent.data.busy
      ? "Agent demo đang chạy một kịch bản khác."
      : scenario.needsOwner && agent.data.network === "fuji"
        ? "Kịch bản này cần khoá chủ két ở phía agent; trên Fuji chủ két là ví của trưởng nhóm."
        : null;
  const canLive = source === "kich-ban" && scenario.live && liveReason === null;
  const canSimulate = source !== "kich-ban" || Boolean(scenario.preset);
  const effectiveMode: RunMode = mode === "live" && canLive ? "live" : canSimulate ? "simulate" : "live";

  const calls = (): Parsed<CallJson[]> => {
    if (source === "kich-ban")
      return presetCalls ? { ok: true, value: presetCalls } : { ok: false, error: "" };
    if (source === "chuyen") return transferCall(deployment.usdc, 6, to, amountText(amount));
    return parseCalls(json);
  };
  const preview = source === "json" ? null : calls();

  const simulate = useMutation({
    mutationFn: (c: CallJson[]) =>
      getJson<CheckResponse>(`${GUARDIAN_URL}/v1/demo/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: FUJI_CHAIN_ID, vault, calls: c, lang: "vi" }),
      }),
    onSuccess: (r) => {
      // The result is a stored check: seed its detail so the result renders without a second request.
      queryClient.setQueryData(["guardian", "check", r.checkId], {
        ...r,
        createdAt: Date.now(),
        endpoint: "demo",
        vault,
        demo: true,
      });
      void queryClient.invalidateQueries({ queryKey: ["guardian", "checks"] });
    },
  });
  const live = useMutation({
    // The header forces a CORS preflight that only the dashboard origin passes (apps/agent/src/control.ts).
    mutationFn: (id: string) =>
      getJson<Attempt>(`${AGENT_URL}/scenario/${id}`, {
        method: "POST",
        headers: { "x-guardian402-demo": "1" },
      }),
    onSuccess: () => {
      void agent.refetch();
      void queryClient.invalidateQueries();
    },
  });
  const running = simulate.isPending || live.isPending;
  const last = effectiveMode === "live" ? live : simulate;

  const run = () => {
    if (effectiveMode === "live") {
      simulate.reset();
      live.mutate(scenario.id);
      return;
    }
    const c = calls();
    if (!c.ok) {
      setInputError(c.error || "Kịch bản này chỉ chạy thật.");
      return;
    }
    setInputError(null);
    live.reset();
    simulate.mutate(c.value);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !running) {
      e.preventDefault();
      run();
    }
  };

  const resultItem: ActivityItem | null = simulate.data
    ? {
        id: simulate.data.checkId,
        at: Date.now(),
        check: {
          checkId: simulate.data.checkId,
          createdAt: Date.now(),
          endpoint: "demo",
          vault,
          risk: simulate.data.risk,
          score: simulate.data.score,
          latencyMs: simulate.data.latencyMs,
          demo: true,
          ruleIds: simulate.data.findings.map((f) => f.ruleId),
          explanation: simulate.data.explanation,
          paymentTx: null,
        },
        risk: simulate.data.risk,
        outcome: { kind: "trial" },
      }
    : live.data
      ? itemFromAttempt(live.data)
      : null;

  return (
    <>
      <PageHeader title={PAGE.trial}>
        Xem Guardian và két xử lý một giao dịch, không dùng tiền thật.
      </PageHeader>

      {demoOff ? (
        <Notice status="warning" title="Chạy thử chỉ có ở DEMO MODE">
          Guardian đang chạy với DEMO_MODE=false nên không có chạy thử miễn phí.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div onKeyDown={onKeyDown}>
          <Card title="Giao dịch">
            <Tabs
              variant="secondary"
              selectedKey={source}
              onSelectionChange={(k) => {
                setSource(k as Source);
                setInputError(null);
                if (k === "json" && !json.trim()) {
                  const from =
                    source === "chuyen" ? transferCall(deployment.usdc, 6, to, amountText(amount)) : null;
                  setJson(JSON.stringify(from?.ok ? from.value : (presetCalls ?? []), null, 2));
                }
              }}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="Cách tạo giao dịch">
                  <Tabs.Tab id="kich-ban">
                    Kịch bản
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="chuyen">
                    Chuyển USDC
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="json">
                    Tự soạn
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="kich-ban" className="px-0 pt-4 pb-0">
                <ListBox
                  aria-label="Kịch bản"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[scenarioId]}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const next = [...keys][0];
                    if (next) setScenarioId(String(next) as Scenario["id"]);
                  }}
                  className="flex flex-col gap-1 p-0"
                >
                  {SCENARIOS.map((s) => (
                    <ListBox.Item
                      key={s.id}
                      id={s.id}
                      textValue={s.title}
                      className="items-start gap-3 rounded-xl px-3 py-2.5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label className="font-medium">{s.title}</Label>
                          {s.attack ? (
                            <Chip size="sm" variant="soft" color="danger">
                              Tấn công mô phỏng
                            </Chip>
                          ) : null}
                          {!s.preset ? (
                            <Chip size="sm" variant="tertiary">
                              Chỉ chạy thật
                            </Chip>
                          ) : null}
                        </div>
                        <Description>{s.story}</Description>
                        <span className="text-xs text-muted">Mong đợi: {s.expected}</span>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Tabs.Panel>

              <Tabs.Panel id="chuyen" className="flex flex-col gap-4 px-0 pt-4 pb-0">
                <TextInput
                  label="Người nhận"
                  value={to}
                  onChange={(v) => {
                    setTo(v);
                    setInputError(null);
                  }}
                  mono
                  error={source === "chuyen" ? inputError : null}
                  description="Người nhận phải nằm trong danh sách tin cậy của két, nếu không két sẽ từ chối."
                />
                <NumberField
                  value={amount}
                  onChange={(v) => {
                    setAmount(v);
                    setInputError(null);
                  }}
                  minValue={0}
                  step={0.5}
                  formatOptions={{ maximumFractionDigits: 6 }}
                >
                  <Label>Số tiền (USDC)</Label>
                  <NumberField.Group>
                    <NumberField.DecrementButton />
                    <NumberField.Input className="tabular-nums" />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                </NumberField>
              </Tabs.Panel>

              <Tabs.Panel id="json" className="px-0 pt-4 pb-0">
                <TextField
                  value={json}
                  onChange={(v) => {
                    setJson(v);
                    setInputError(null);
                  }}
                  isInvalid={source === "json" && Boolean(inputError)}
                >
                  <Label>Các bước của giao dịch (JSON)</Label>
                  <TextArea
                    rows={9}
                    spellCheck={false}
                    placeholder='[{ "target": "0x…", "value": "0", "data": "0x…" }]'
                    className="font-mono text-xs"
                  />
                  <Description>
                    Tối đa 8 bước, mỗi bước {"{ target, value, data }"}; value tính bằng wei.
                  </Description>
                  <FieldError>{inputError}</FieldError>
                </TextField>
              </Tabs.Panel>
            </Tabs>

            {preview?.ok && preview.value.length ? (
              <TechDetails label={`Giao dịch gồm ${preview.value.length} bước`}>
                <ul className="flex flex-col gap-1">
                  {preview.value.map((c, i) => (
                    <li key={i} className="font-mono break-all">
                      {describeCall(c, knownToken)}
                    </li>
                  ))}
                </ul>
              </TechDetails>
            ) : null}

            <RadioGroup value={effectiveMode} onChange={(v) => setMode(v as RunMode)} className="gap-3">
              <Label>Chạy thế nào</Label>
              <Radio value="simulate" isDisabled={!canSimulate}>
                <Radio.Content>
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  Chỉ mô phỏng
                </Radio.Content>
                <Description>
                  {canSimulate
                    ? "Miễn phí. Không gửi gì lên chain."
                    : "Kịch bản này cần chạy thật mới có kết quả."}
                </Description>
              </Radio>
              <Radio value="live" isDisabled={!canLive}>
                <Radio.Content>
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  Chạy thật trên {NETWORK === "fuji" ? "mạng thử Fuji" : "fork"}
                </Radio.Content>
                <Description>
                  {source !== "kich-ban"
                    ? "Chỉ các kịch bản có sẵn mới chạy thật được."
                    : (liveReason ??
                      `Agent demo trả phí kiểm tra bằng USDC thử nghiệm và gửi giao dịch vào két demo.`)}
                </Description>
              </Radio>
            </RadioGroup>
            {effectiveMode === "live" && !isDemoVault ? (
              <p className="text-xs text-muted">
                Chạy thật luôn dùng két demo <AddressLink address={deployment.vault} />, không phải két đang
                chọn.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-separator pt-4">
              <Button
                variant="primary"
                isPending={running}
                isDisabled={demoOff && effectiveMode === "simulate"}
                onPress={run}
              >
                {running ? "Đang chạy…" : effectiveMode === "live" ? "Chạy thật" : "Chạy thử"}
                <Kbd className="ml-1 hidden sm:inline-flex" aria-hidden="true">
                  <Kbd.Content>Ctrl</Kbd.Content>
                  <Kbd.Abbr keyValue="enter" />
                </Kbd>
              </Button>
            </div>
          </Card>
        </div>

        <div className="xl:sticky xl:top-20">
          <Card
            title="Kết quả"
            actions={
              resultItem ? (
                <NextLink href="/hoat-dong" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Xem trong Hoạt động
                </NextLink>
              ) : null
            }
          >
            <div aria-live="polite" className="flex flex-col gap-4">
              {running ? (
                <Journey
                  stops={[
                    {
                      label: "Agent đề xuất",
                      value: effectiveMode === "live" ? scenario.title : "Giao dịch đã soạn",
                      tone: "info",
                    },
                    { label: "Guardian kiểm tra", value: "Đang chạy thử trên fork Fuji…", tone: "active" },
                    {
                      label: effectiveMode === "live" ? "Két quyết định" : "Két quyết định (dự đoán)",
                      value: effectiveMode === "live" ? "Chờ agent gửi giao dịch" : "Chờ kết quả",
                      tone: "waiting",
                    },
                  ]}
                />
              ) : last.isError ? (
                <ErrorBox
                  title={
                    last.error instanceof HttpError && last.error.status === 400
                      ? "Giao dịch không hợp lệ"
                      : "Chưa chạy được"
                  }
                  detail={`${errorText(last.error)} Giao dịch bạn soạn vẫn giữ nguyên.`}
                  onRetry={run}
                />
              ) : resultItem ? (
                <>
                  {live.data && !live.data.matched ? (
                    <Notice status="warning" title="Kết quả khác mong đợi">
                      {live.data.mismatch ?? "Kiểm tra trạng thái dịch vụ và két."}
                    </Notice>
                  ) : null}
                  <DetailBody item={resultItem} />
                </>
              ) : (
                <p className="py-8 text-center text-sm text-muted">
                  Chọn một kịch bản rồi bấm Chạy thử. Kết quả hiện ở đây.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
