"use client";

import { Accordion } from "@heroui/react/accordion";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Button } from "@heroui/react/button";
import { Label } from "@heroui/react/label";
import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { formatUnits, getAddress, isAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { ConfirmInline, FormError, Pill, errorOf } from "@/components/form";
import { Card, ErrorBox, Loading } from "@/components/ui";
import { accountApi, AccountApiError } from "@/lib/account";
import { CONTRACTS, naming, TEMPLATES, templateSpec, type TemplateId } from "@/lib/policy-catalog";
import {
  EMPTY_SPEC,
  specWarnings,
  summarizePermissions,
  type PolicySpec,
  type RiskCode,
} from "@/lib/policy-spec";
import {
  CONTACT_KIND_LABEL,
  useContacts,
  useInvalidate,
  wsApi,
  type Assignment,
  type Budget,
  type Contact,
  type Policy,
} from "@/lib/workspace";
import { PolicyCheckbox, PolicyInput } from "./policy-fields";
import { assetRows, firstBudgetIssue, OFF, toForm, toSpec, type PolicyForm } from "./policy-form";
import { PolicyPreview } from "./policy-preview";
import { PolicyStageHeader } from "./policy-stage";

const STEPS = [
  {
    label: "Bắt đầu",
    title: "Chọn mẫu và đặt tên",
    next: "Đặt ngân sách",
  },
  {
    label: "Ngân sách",
    title: "Agent được chi bao nhiêu?",
    next: "Chọn quyền thực thi",
  },
  {
    label: "Quyền thực thi",
    title: "Agent được làm gì?",
    next: "Xem lại policy",
  },
  {
    label: "Xem lại",
    title: "Kiểm tra trước khi lưu",
  },
] as const;
const REVIEW = STEPS.length - 1;
const RISKS = ["Chỉ rủi ro thấp", "Đến rủi ro trung bình", "Cho phép cả rủi ro cao"];
const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
const selected = (addresses: Address[], address: Address) => addresses.some((a) => same(a, address));
const toggle = (addresses: Address[], address: Address, on: boolean) =>
  on ? [...addresses.filter((a) => !same(a, address)), address] : addresses.filter((a) => !same(a, address));

export function PolicyBuilder({
  vault,
  vaultLabel,
  initial,
  baseline,
  budgets,
  onSaved,
  onCancel,
}: {
  vault: Address;
  vaultLabel: string;
  initial: Policy | undefined;
  baseline: Assignment | undefined;
  budgets: Budget[] | undefined;
  onSaved: (result: { message: string; policyId: number }) => void;
  onCancel: () => void;
}) {
  const contacts = useContacts(vault);
  const rows = assetRows(...(initial ? [initial.latest.spec] : []));
  const [extra, setExtra] = useState<Contact[]>([]);
  const people = [
    ...(contacts.data?.contacts ?? []),
    ...extra.filter((x) => !contacts.data?.contacts.some((c) => c.id === x.id)),
  ];
  const names = naming(people);
  const [step, setStep] = useState(0);
  const [previewState, setPreviewState] = useState<"initial" | "open" | "closed">("initial");
  const previewOpen = step === REVIEW && previewState === "open";
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [template, setTemplate] = useState<TemplateId>(initial?.template ?? "payments");
  const [nextTemplate, setNextTemplate] = useState<TemplateId | null>(null);
  const [note, setNote] = useState("");
  const [form, setForm] = useState(() => toForm(initial?.latest.spec ?? templateSpec("payments", []), rows));
  const [issue, setIssue] = useState<{ message: string; field?: string } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const current = STEPS[step] ?? STEPS[0];

  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
    const nextHeading = previewOpen ? document.getElementById("wizard-preview-title") : heading.current;
    nextHeading?.focus({ preventScroll: true });
  }, [step, previewOpen]);

  let spec: PolicySpec | null = null;
  let specError = "";
  try {
    spec = toSpec(form, rows, vault);
  } catch (e) {
    specError = errorOf(e);
  }
  const warnings = spec ? specWarnings(spec, names) : [];
  const save = useMutation({
    mutationFn: async () => {
      if (!spec || !name.trim()) throw new Error(specError || "Nhập tên policy.");
      const body = { name: name.trim(), description, spec, note, template };
      if (initial) {
        const r = await accountApi<{ newVersion: number | null }>(
          `/api/policies/${initial.id}?vault=${vault}`,
          "PATCH",
          body,
        );
        return {
          policyId: initial.id,
          message: r.newVersion
            ? `Đã lưu “${body.name}” v${r.newVersion}. Agent tiếp tục dùng phiên bản đã gán.`
            : `Đã lưu “${body.name}”. Phiên bản quy tắc giữ nguyên.`,
        };
      }
      const r = await accountApi<{ policy: Policy }>(`/api/policies?vault=${vault}`, "POST", body);
      return {
        policyId: r.policy.id,
        message: `Đã lưu “${body.name}”.`,
      };
    },
    onSuccess: onSaved,
  });
  const set = (patch: Partial<PolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  const setAsset = (key: string, patch: Partial<(typeof form.assets)[string]>) =>
    setForm((f) => ({ ...f, assets: { ...f.assets, [key]: { ...(f.assets[key] ?? OFF), ...patch } } }));

  const applyTemplate = (id: TemplateId) => {
    setTemplate(id);
    // A contact in the address book has no implied permission to receive vault funds.
    setForm(toForm(templateSpec(id, []), rows));
    setNextTemplate(null);
    setIssue(null);
  };
  const pickTemplate = (id: TemplateId) => {
    if (JSON.stringify(form) !== JSON.stringify(toForm(templateSpec(template, []), rows)))
      setNextTemplate(id);
    else applyTemplate(id);
  };
  const go = (target: number) => {
    if (target > step) {
      const nextIssue =
        step === 0 && !name.trim()
          ? { message: "Nhập tên policy để tiếp tục.", field: "policy-name" }
          : step === 1
            ? firstBudgetIssue(form, rows)
            : step === 2 && !spec
              ? { message: specError }
              : null;
      if (nextIssue) {
        setIssue(nextIssue);
        if ("field" in nextIssue) document.getElementById(nextIssue.field)?.focus();
        return;
      }
    }
    setIssue(null);
    if (previewOpen) setPreviewState("closed");
    setStep(target);
  };
  const changeSelector = (address: Address, selector: Hex, on: boolean) => {
    setForm((current) => {
      const existing = current.contracts.find((x) => same(x.address, address));
      const selectors = (existing?.selectors ?? []).filter((s) => s !== selector);
      if (on) selectors.push(selector);
      return {
        ...current,
        contracts: [
          ...current.contracts.filter((x) => !same(x.address, address)),
          ...(selectors.length ? [{ address, selectors }] : []),
        ],
      };
    });
  };
  return (
    <div ref={top} className="mx-auto flex w-full max-w-[66rem] min-w-0 scroll-mt-5 flex-col gap-5">
      <PolicyStageHeader
        title={previewOpen ? "Thử bản đang soạn" : initial ? "Chỉnh sửa policy" : "Tạo policy"}
        caption={name.trim() || undefined}
        vault={vault}
        vaultLabel={vaultLabel}
        exitLabel={previewOpen ? "Về bản soạn" : "Thoát"}
        onExit={() => (previewOpen ? setPreviewState("closed") : setConfirmExit(true))}
        busy={save.isPending}
      />

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
        <nav aria-label="Tiến độ soạn policy" className="min-w-0 lg:sticky lg:top-5 lg:pt-2">
          <div className="lg:hidden">
            <p className="mb-2 text-sm font-semibold text-muted">
              Bước {step + 1}/{STEPS.length} · {current.label}
            </p>
            <div aria-hidden="true" className="grid grid-cols-4 gap-1.5">
              {STEPS.map(({ label }, i) => (
                <span key={label} className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
              ))}
            </div>
          </div>
          <ol className="hidden flex-col gap-1 lg:flex">
            {STEPS.map(({ label }, i) => (
              <li key={label} aria-current={step === i ? "step" : undefined}>
                {i < step ? (
                  <Button
                    variant="ghost"
                    fullWidth
                    type="button"
                    isDisabled={save.isPending}
                    onPress={() => go(i)}
                    className="min-h-[42px] justify-start gap-3 px-3 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-surface text-xs"
                    >
                      ✓
                    </span>
                    {label}
                  </Button>
                ) : (
                  <div
                    className={`flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm ${i === step ? "bg-surface font-semibold text-fg" : "text-muted"}`}
                  >
                    <span
                      className={`inline-grid size-6 shrink-0 place-items-center rounded-full text-xs tabular-nums ${i === step ? "bg-accent text-accent-fg" : "border border-current"}`}
                    >
                      {i + 1}
                    </span>
                    {label}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <Card className="gap-0! overflow-visible! p-0!">
          <div className={previewOpen ? "hidden" : "flex min-w-0 flex-col gap-5 p-5 sm:p-6"}>
            <div>
              <h2 ref={heading} tabIndex={-1} className="text-xl font-bold tracking-tight outline-none">
                {step === 0 && initial ? "Tên policy" : current.title}
              </h2>
            </div>
            {step === 0 ? (
              <>
                {!initial ? (
                  <RadioGroup
                    aria-label="Mẫu policy"
                    value={template}
                    onChange={(value) => pickTemplate(value as TemplateId)}
                  >
                    <Label className="text-sm font-semibold">Mẫu policy</Label>
                    <div className="divide-y divide-line">
                      {TEMPLATES.map((t) => (
                        <Choice
                          key={t.id}
                          value={t.id}
                          title={t.name}
                          description={t.description}
                          demo={t.id === "swap"}
                        />
                      ))}
                    </div>
                  </RadioGroup>
                ) : null}
                {nextTemplate ? (
                  <ConfirmInline
                    text="Đổi mẫu sẽ thay thế các quy tắc bạn đang soạn."
                    confirmLabel="Đổi mẫu"
                    onConfirm={() => applyTemplate(nextTemplate)}
                    onCancel={() => setNextTemplate(null)}
                  />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <PolicyInput
                    id="policy-name"
                    label="Tên policy"
                    required
                    maxLength={60}
                    value={name}
                    aria-invalid={issue?.field === "policy-name"}
                    onChange={(e) => {
                      setName(e.target.value);
                      setIssue(null);
                    }}
                  />
                  <PolicyInput
                    id="policy-description"
                    label="Mô tả (không bắt buộc)"
                    maxLength={300}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </>
            ) : null}

            {step === 1 ? (
              <section aria-label="Tài sản và hạn mức">
                <p className="text-sm text-muted">
                  Hạn mức tính theo số dư giảm trong ngày UTC, chung cho vault. Tắt tài sản đang theo dõi sẽ
                  đưa hạn mức về 0 khi áp dụng.
                </p>
                <div className="mt-2 divide-y divide-line">
                  {rows.map((row) => {
                    const a = form.assets[row.key] ?? OFF;
                    return (
                      <div
                        key={row.key}
                        className={`px-3 py-1 ${a.enabled ? "rounded-xl bg-surface-2" : ""}`}
                      >
                        <PolicyCheckbox
                          checked={a.enabled}
                          onChange={(enabled) => setAsset(row.key, { enabled })}
                        >
                          <strong>{row.symbol}</strong> {row.demo ? <Pill tone="warn">DEMO</Pill> : null}
                        </PolicyCheckbox>
                        {a.enabled ? (
                          <div className="grid gap-3 pb-3 sm:grid-cols-2">
                            <PolicyInput
                              id={`cap-${row.key}`}
                              label={`Ngân sách/ngày (${row.symbol})`}
                              value={a.cap}
                              className="font-semibold tabular-nums"
                              inputMode="decimal"
                              aria-invalid={issue?.field === `cap-${row.key}`}
                              onChange={(e) => {
                                setAsset(row.key, { cap: e.target.value });
                                setIssue(null);
                              }}
                            />
                            <PolicyInput
                              id={`threshold-${row.key}`}
                              label={`Cần Guardian ký khi chi vượt (${row.symbol})`}
                              hint="Đặt 0 để mọi khoản chi đều cần chữ ký."
                              value={a.threshold}
                              className="tabular-nums"
                              inputMode="decimal"
                              aria-invalid={issue?.field === `threshold-${row.key}`}
                              onChange={(e) => {
                                setAsset(row.key, { threshold: e.target.value });
                                setIssue(null);
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <>
                <section className="flex flex-col gap-3" aria-label="Người nhận tiền">
                  <div>
                    <h3 className="font-semibold">Ai được nhận tiền?</h3>
                    <p className="mt-1 text-sm text-muted">
                      Chọn từ danh bạ. Chỉ lưu liên hệ thì chưa cấp quyền.
                    </p>
                  </div>
                  {contacts.isPending ? <Loading label="Đang tải danh bạ…" /> : null}
                  {contacts.isError ? (
                    <ErrorBox
                      title="Không tải được danh bạ"
                      detail={errorOf(contacts.error)}
                      onRetry={() => void contacts.refetch()}
                    />
                  ) : null}
                  <AddressChecklist
                    options={people.map(contactOption)}
                    value={form.recipients}
                    onChange={(recipients) => set({ recipients })}
                  />
                  <QuickContact
                    vault={vault}
                    onAdded={(c) => {
                      setExtra((prev) => [...prev, c]);
                      setForm((prev) => ({ ...prev, recipients: toggle(prev.recipients, c.address, true) }));
                    }}
                  />
                </section>
                <Accordion aria-label="Quyền contract và approval" allowsMultipleExpanded>
                  <Accordion.Item id="contracts">
                    <Accordion.Heading>
                      <Accordion.Trigger className="min-h-[42px] text-left">
                        Gọi contract{" "}
                        <Pill>{form.contracts.reduce((n, c) => n + c.selectors.length, 0)} thao tác</Pill>
                        <Accordion.Indicator />
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="flex flex-col gap-3">
                        <p className="text-sm text-muted">
                          Vault kiểm tra địa chỉ contract và selector. Số dư thực giảm vẫn tính vào hạn mức.
                        </p>
                        {CONTRACTS.map((c) => (
                          <section key={c.address} className="border-b border-line pb-2">
                            <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                              {c.name}
                              {c.demo ? <Pill tone="warn">DEMO</Pill> : null}
                            </h4>
                            <p className="font-mono text-xs text-muted wrap-anywhere">{c.address}</p>
                            {c.functions.map((fn) => (
                              <PolicyCheckbox
                                key={fn.selector}
                                checked={form.contracts.some(
                                  (x) => same(x.address, c.address) && x.selectors.includes(fn.selector),
                                )}
                                onChange={(on) => changeSelector(c.address, fn.selector, on)}
                              >
                                <span className="font-semibold">{fn.name}</span>{" "}
                                <span className="text-muted">· {fn.hint}</span>
                              </PolicyCheckbox>
                            ))}
                          </section>
                        ))}
                        {form.contracts.flatMap((c) =>
                          c.selectors
                            .filter(
                              (selector) =>
                                !CONTRACTS.some(
                                  (item) =>
                                    same(item.address, c.address) &&
                                    item.functions.some((fn) => fn.selector === selector),
                                ),
                            )
                            .map((selector) => (
                              <div
                                key={`${c.address}-${selector}`}
                                className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2"
                              >
                                <div className="min-w-0 font-mono text-xs wrap-anywhere">
                                  {c.address}
                                  <br />
                                  {selector}
                                </div>
                                <Button
                                  variant="secondary"
                                  type="button"
                                  aria-label={`Bỏ thao tác ${selector} trên ${c.address}`}
                                  onPress={() => changeSelector(c.address, selector, false)}
                                >
                                  Bỏ
                                </Button>
                              </div>
                            )),
                        )}
                        <OtherContract
                          onAdd={(address, selector) => changeSelector(address, selector, true)}
                        />
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item id="approval">
                    <Accordion.Heading>
                      <Accordion.Trigger className="min-h-[42px] text-left">
                        Cấp approval <Pill>{form.spenders.length} bên được chọn</Pill>
                        <Accordion.Indicator />
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="flex flex-col gap-3">
                        <p className="rounded-lg bg-medium-bg p-3 text-sm text-medium">
                          Địa chỉ được cấp approval cũng có quyền nhận tiền trên vault này.
                        </p>
                        <p className="text-sm text-muted">
                          Approval khác 0 cần Guardian ký. Vault thu hồi quyền còn lại sau batch.
                        </p>
                        <AddressChecklist
                          options={[
                            ...CONTRACTS.map((c) => ({
                              address: c.address,
                              label: c.name,
                              sub: c.demo ? "Contract DEMO" : "Contract",
                            })),
                            ...people
                              .filter((p) => !CONTRACTS.some((c) => same(c.address, p.address)))
                              .map(contactOption),
                          ]}
                          value={form.spenders}
                          onChange={(spenders) => set({ spenders })}
                        />
                        {rows.some((row) => row.token !== "native" && form.assets[row.key]?.enabled) ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {rows
                              .filter((row) => row.token !== "native" && form.assets[row.key]?.enabled)
                              .map((row) => (
                                <PolicyInput
                                  key={row.key}
                                  id={`approval-${row.key}`}
                                  label={`Approval tối đa/lần (${row.symbol})`}
                                  value={form.assets[row.key]?.maxApproval ?? "0"}
                                  inputMode="decimal"
                                  onChange={(e) => setAsset(row.key, { maxApproval: e.target.value })}
                                />
                              ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted">Bật một token ở bước 1 để đặt mức approval.</p>
                        )}
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
                <RadioGroup
                  aria-label="Mức rủi ro verdict tối đa"
                  value={String(form.maxRisk)}
                  onChange={(value) => set({ maxRisk: Number(value) as RiskCode })}
                >
                  <Label className="text-sm font-semibold">Rủi ro tối đa khi có verdict</Label>
                  <p className="text-sm text-muted">Guardian chấm rủi ro bằng luật.</p>
                  <div className="divide-y divide-line">
                    {RISKS.map((label, i) => (
                      <Choice
                        key={label}
                        value={String(i)}
                        title={label}
                        description={
                          i === 0
                            ? "Mặc định"
                            : i === 2
                              ? "Chỉ dùng khi bạn chủ động chấp nhận rủi ro cao."
                              : undefined
                        }
                      />
                    ))}
                  </div>
                </RadioGroup>
              </>
            ) : null}

            {step === REVIEW ? (
              <>
                <strong className="wrap-anywhere">{name}</strong>
                {description ? <p className="text-sm text-muted wrap-anywhere">{description}</p> : null}
                {spec ? <Summary spec={spec} names={names} rows={rows} /> : null}
                {warnings.length ? (
                  <ul className="flex list-disc flex-col gap-2 rounded-xl bg-medium-bg py-3 pr-4 pl-8 text-sm text-medium">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                {initial ? (
                  <PolicyInput
                    id="policy-note"
                    label="Ghi chú phiên bản (không bắt buộc)"
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Button variant="secondary" type="button" onPress={() => setPreviewState("open")}>
                    Thử policy
                  </Button>
                  <span className="text-sm text-muted">Tuỳ chọn</span>
                </div>
                <p className="text-sm text-muted">
                  Để áp dụng lên vault, gán policy cho agent rồi ký bằng ví chủ.
                </p>
              </>
            ) : null}
          </div>
          <div id="wizard-policy-preview" hidden={!previewOpen} className="min-w-0 p-5 sm:p-6">
            {previewState !== "initial" ? (
              <PolicyPreview
                spec={spec ?? EMPTY_SPEC}
                contacts={people}
                names={names}
                baseline={baseline}
                budgets={budgets}
              />
            ) : null}
          </div>
          {previewOpen ? (
            <footer className="flex justify-end border-t border-line px-5 py-3 sm:px-6">
              <Button variant="primary" type="button" onPress={() => setPreviewState("closed")}>
                Về bước xem lại
              </Button>
            </footer>
          ) : (
            <footer className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-b-[20px] border-t border-line bg-surface px-5 py-3 sm:px-6">
              {issue ? (
                <p role="alert" className="text-sm text-high">
                  {issue.message}
                </p>
              ) : null}
              {step === REVIEW ? <FormError error={save.error} /> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {step > 0 ? (
                  <Button
                    variant="ghost"
                    type="button"
                    isDisabled={save.isPending}
                    onPress={() => go(step - 1)}
                  >
                    Quay lại
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  variant="primary"
                  type="button"
                  isDisabled={save.isPending || nextTemplate !== null}
                  onPress={() => (step === REVIEW ? save.mutate() : go(step + 1))}
                >
                  {save.isPending ? "Đang lưu…" : "next" in current ? current.next : "Lưu và tiếp tục"}
                </Button>
              </div>
            </footer>
          )}
        </Card>
      </div>

      <AlertDialog.Backdrop isOpen={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>Rời trình tạo policy?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">Thay đổi chưa lưu trong trình tạo sẽ bị bỏ.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="secondary" onPress={() => setConfirmExit(false)}>
                Tiếp tục soạn
              </Button>
              <Button variant="danger" onPress={onCancel}>
                Rời trình tạo
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

function Summary({
  spec,
  names,
  rows,
}: {
  spec: PolicySpec;
  names: ReturnType<typeof naming>;
  rows: ReturnType<typeof assetRows>;
}) {
  const limits = rows.flatMap((row) => {
    const rule =
      row.token === "native" ? spec.native : spec.tokens.find((t) => t.token.toLowerCase() === row.key);
    return rule && BigInt(rule.dailyCap) > 0n ? [{ row, rule }] : [];
  });
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-surface-2 px-4 py-3 sm:px-5" aria-labelledby="policy-review-budget">
        <h3 id="policy-review-budget" className="text-sm font-semibold">
          Hạn mức mỗi ngày <span className="font-normal text-muted">· UTC</span>
        </h3>
        {limits.length ? (
          <ul className="mt-1 divide-y divide-line">
            {limits.map(({ row, rule }) => (
              <li
                key={row.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="min-w-0 font-bold tabular-nums wrap-anywhere">
                  <span className="text-xl">{formatUnits(BigInt(rule.dailyCap), row.decimals)}</span>{" "}
                  {row.symbol}
                </span>
                <span className="text-sm text-muted wrap-anywhere">
                  {BigInt(rule.verdictThreshold) < BigInt(rule.dailyCap)
                    ? `Guardian ký khi chi vượt ${formatUnits(BigInt(rule.verdictThreshold), row.decimals)} ${row.symbol}`
                    : "Ngưỡng ký bằng hoặc cao hơn hạn mức"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Hạn mức chi bằng 0.</p>
        )}
      </section>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
        {summarizePermissions(spec, names).map((line) => (
          <li key={line} className="wrap-anywhere">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Choice({
  value,
  title,
  description,
  demo,
}: {
  value: string;
  title: string;
  description?: string | undefined;
  demo?: boolean;
}) {
  return (
    <Radio value={value} className="min-w-0">
      <Radio.Content className="min-h-[42px] w-full items-start gap-3 rounded-lg border-s-2 border-transparent px-3 py-2.5 data-[selected]:border-accent data-[selected]:bg-surface-2">
        <Radio.Control className="mt-0.5 shrink-0 border border-muted/45">
          <Radio.Indicator />
        </Radio.Control>
        <Label className="flex min-w-0 flex-col gap-0.5 text-sm">
          <span className="font-semibold">
            {title} {demo ? <Pill tone="warn">DEMO</Pill> : null}
          </span>
          {description ? <span className="text-muted">{description}</span> : null}
        </Label>
      </Radio.Content>
    </Radio>
  );
}

const contactOption = (c: Contact) => ({
  address: c.address,
  label: c.name,
  sub: CONTACT_KIND_LABEL[c.kind],
});

function AddressChecklist({
  options,
  value,
  onChange,
}: {
  options: { address: Address; label: string; sub: string }[];
  value: Address[];
  onChange: (addresses: Address[]) => void;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const unknown = value.filter((a) => !options.some((o) => same(o.address, a)));
  const all = [...options, ...unknown.map((address) => ({ address, label: "Ngoài danh bạ", sub: "" }))];
  const query = search.trim().toLowerCase();
  const visible = all.filter((o) => `${o.label} ${o.address}`.toLowerCase().includes(query));
  return (
    <div className="flex flex-col gap-2">
      {all.length > 6 ? (
        <PolicyInput
          id={searchId}
          label="Lọc theo tên hoặc địa chỉ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      ) : null}
      <p className="text-sm tabular-nums text-muted">{value.length} địa chỉ đã chọn</p>
      {visible.length ? (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl bg-surface-2 px-3">
          {visible.map((option) => (
            <li key={option.address}>
              <PolicyCheckbox
                checked={selected(value, option.address)}
                onChange={(on) => onChange(toggle(value, option.address, on))}
              >
                <span className="block font-semibold">
                  {option.label}{" "}
                  {option.sub ? <span className="font-normal text-muted">· {option.sub}</span> : null}
                </span>
                <span className="block font-mono text-xs text-muted wrap-anywhere">{option.address}</span>
              </PolicyCheckbox>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {all.length ? "Không tìm thấy địa chỉ phù hợp." : "Chưa có địa chỉ để chọn."}
        </p>
      )}
    </div>
  );
}

function QuickContact({ vault, onAdded }: { vault: Address; onAdded: (contact: Contact) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const invalidate = useInvalidate(vault);
  const add = useMutation({
    mutationFn: () =>
      wsApi<{ contact: Contact }>(vault, "contacts", "POST", {
        name,
        address: address.trim(),
        kind: "recipient",
      }),
    onSuccess: ({ contact }) => {
      onAdded({ ...contact, allowlisted: { recipient: false, target: false } });
      void invalidate("contacts");
      setName("");
      setAddress("");
      setOpen(false);
    },
  });
  if (!open)
    return (
      <Button
        variant="secondary"
        type="button"
        className="self-start"
        onPress={() => {
          add.reset();
          setOpen(true);
        }}
      >
        Thêm người nhận vào danh bạ
      </Button>
    );
  const lookalike = add.error instanceof AccountApiError && add.error.code === "lookalike";
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PolicyInput
          id="policy-contact-name"
          label="Tên liên hệ"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <PolicyInput
          id="policy-contact-address"
          label="Địa chỉ liên hệ"
          placeholder="0x…"
          spellCheck={false}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      {lookalike ? (
        <p role="alert" className="text-sm text-high">
          {errorOf(add.error)} Kiểm tra và xác nhận ở tab Danh bạ.
        </p>
      ) : (
        <FormError error={add.error} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="button"
          isDisabled={add.isPending || !name.trim() || !address.trim()}
          onPress={() => add.mutate()}
        >
          {add.isPending ? "Đang lưu…" : "Lưu và chọn"}
        </Button>
        <Button variant="secondary" type="button" isDisabled={add.isPending} onPress={() => setOpen(false)}>
          Đóng
        </Button>
      </div>
    </div>
  );
}

function OtherContract({ onAdd }: { onAdd: (address: Address, selector: Hex) => void }) {
  const [address, setAddress] = useState("");
  const [fn, setFn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const a = address.trim();
    const f = fn.trim();
    if (!isAddress(a)) return setError("Địa chỉ contract không hợp lệ.");
    try {
      const selector = /^0x[0-9a-fA-F]{8}$/.test(f)
        ? (f.toLowerCase() as Hex)
        : toFunctionSelector(f.startsWith("function ") ? f : `function ${f}`);
      onAdd(getAddress(a), selector);
      setError(null);
      setFn("");
    } catch {
      setError("Nhập chữ ký hàm như deposit(uint256) hoặc selector 0x12345678.");
    }
  };
  return (
    <details>
      <summary className="min-h-[42px] cursor-pointer py-2.5 text-sm font-semibold">
        Thêm thao tác tuỳ chỉnh
      </summary>
      <div className="grid gap-3 sm:grid-cols-2">
        <PolicyInput
          id="custom-contract-address"
          label="Địa chỉ contract"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
        />
        <PolicyInput
          id="custom-contract-function"
          label="Chữ ký hàm hoặc selector"
          placeholder="deposit(uint256)"
          value={fn}
          spellCheck={false}
          onChange={(e) => setFn(e.target.value)}
        />
      </div>
      <FormError error={error} />
      <Button variant="secondary" type="button" className="mt-3" onPress={add}>
        Thêm thao tác
      </Button>
    </details>
  );
}
