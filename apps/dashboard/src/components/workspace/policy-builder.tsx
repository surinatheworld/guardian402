"use client";
// Policy builder: six business questions → a PolicySpec, with the plain-language summary and "Thử policy" beside
// the form. Saving stores a policy (or a new version of it); it does not change any agent or the vault.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { formatUnits, isAddress, parseUnits, toFunctionSelector, type Address, type Hex } from "viem";
import { accountApi, AccountApiError } from "@/lib/account";
import { ASSETS, CONTRACTS, naming, TEMPLATES, templateSpec, type TemplateId } from "@/lib/policy-catalog";
import {
  evaluate,
  exampleScenarios,
  RISK_WORD,
  summarize,
  specWarnings,
  type Outcome,
  type PolicySpec,
  type RiskCode,
} from "@/lib/policy-spec";
import { Card } from "@/components/ui";
import { Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import { CONTACT_KIND_LABEL, useContacts, wsApi, type Contact, type Policy } from "@/lib/workspace";

// ------------------------------------------------------------------ form model (decimal strings)

type AssetForm = { enabled: boolean; cap: string; threshold: string; maxApproval: string };
type Form = {
  assets: Record<string, AssetForm>; // token address (lower case) or "native"
  recipients: Address[];
  spenders: Address[];
  contracts: { address: Address; selectors: Hex[] }[];
  maxRisk: RiskCode;
};

type AssetRow = { key: string; token: Address | "native"; symbol: string; decimals: number; demo: boolean };
const NATIVE_ROW: AssetRow = { key: "native", token: "native", symbol: "AVAX", decimals: 18, demo: false };
const ASSET_ROWS: AssetRow[] = [
  ...ASSETS.map((a) => ({ ...a, key: a.token.toLowerCase(), token: a.token as Address | "native" })),
  NATIVE_ROW,
];
const OFF: AssetForm = { enabled: false, cap: "", threshold: "", maxApproval: "0" };
const fmt = (raw: string, decimals: number) => formatUnits(BigInt(raw), decimals);

function toForm(s: PolicySpec): Form {
  const assets: Record<string, AssetForm> = {};
  for (const row of ASSET_ROWS) {
    if (row.token === "native") {
      const on = BigInt(s.native.dailyCap) > 0n;
      assets.native = {
        enabled: on,
        cap: on ? fmt(s.native.dailyCap, 18) : "",
        threshold: on ? fmt(s.native.verdictThreshold, 18) : "",
        maxApproval: "0",
      };
      continue;
    }
    const t = s.tokens.find((x) => x.token.toLowerCase() === row.key);
    assets[row.key] = t
      ? {
          enabled: true,
          cap: fmt(t.dailyCap, row.decimals),
          threshold: fmt(t.verdictThreshold, row.decimals),
          maxApproval: fmt(t.maxApproval, row.decimals),
        }
      : { enabled: false, cap: "", threshold: "", maxApproval: "0" };
  }
  return {
    assets,
    recipients: s.recipients,
    spenders: s.spenders,
    contracts: s.contracts,
    maxRisk: s.maxRisk,
  };
}

const units = (v: string, decimals: number, label: string) => {
  const t = v.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`${label}: nhập một số ≥ 0.`);
  try {
    return parseUnits(t, decimals).toString();
  } catch {
    throw new Error(`${label}: quá nhiều chữ số thập phân.`);
  }
};

function toSpec(f: Form): PolicySpec {
  const tokens: PolicySpec["tokens"] = [];
  let native = { dailyCap: "0", verdictThreshold: "0" };
  for (const row of ASSET_ROWS) {
    const a = f.assets[row.key];
    if (!a?.enabled) continue;
    const cap = units(a.cap, row.decimals, `${row.symbol} – ngân sách/ngày`);
    const threshold = units(a.threshold, row.decimals, `${row.symbol} – ngưỡng cần verdict`);
    if (row.token === "native") native = { dailyCap: cap, verdictThreshold: threshold };
    else
      tokens.push({
        token: row.token,
        dailyCap: cap,
        verdictThreshold: threshold,
        maxApproval: units(a.maxApproval || "0", row.decimals, `${row.symbol} – cấp quyền tối đa`),
      });
  }
  return {
    tokens,
    native,
    recipients: f.recipients,
    spenders: f.spenders,
    contracts: f.contracts,
    maxRisk: f.maxRisk,
  };
}

const toggle = <T,>(xs: T[], x: T, on: boolean) =>
  on ? (xs.includes(x) ? xs : [...xs, x]) : xs.filter((y) => y !== x);

// ------------------------------------------------------------------ builder

export function PolicyBuilder({
  vault,
  initial,
  onSaved,
  onCancel,
}: {
  vault: string;
  initial?: Policy;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const contacts = useContacts(vault);
  const book = useMemo(() => contacts.data?.contacts ?? [], [contacts.data]);
  const names = useMemo(() => naming(book), [book]);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [template, setTemplate] = useState<TemplateId>(initial?.template ?? "payments");
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Form>(() =>
    toForm(initial ? initial.latest.spec : templateSpec("payments", [])),
  );
  const [extra, setExtra] = useState<Contact[]>([]);

  const pickTemplate = (id: TemplateId) => {
    setTemplate(id);
    const payees = book.filter((c) => c.kind === "recipient" || c.kind === "treasury").map((c) => c.address);
    setForm(toForm(templateSpec(id, payees)));
    if (!name || TEMPLATES.some((t) => t.name === name))
      setName(TEMPLATES.find((t) => t.id === id)?.name ?? "");
  };

  let spec: PolicySpec | null = null;
  let specError: string | null = null;
  try {
    spec = toSpec(form);
  } catch (e) {
    specError = errorOf(e);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!spec) throw new Error(specError ?? "Cấu hình chưa hợp lệ.");
      const body = { name, description, spec, note, template };
      if (initial) {
        const r = await accountApi<{ newVersion: number | null }>(
          `/api/policies/${initial.id}?vault=${vault}`,
          "PATCH",
          body,
        );
        return r.newVersion
          ? `Đã lưu phiên bản ${r.newVersion} của “${name}”. Agent đang dùng bản cũ giữ nguyên cho tới khi bạn chuyển.`
          : `Đã lưu “${name}” (quy tắc không đổi nên không tạo phiên bản mới).`;
      }
      await accountApi(`/api/policies?vault=${vault}`, "POST", body);
      return `Đã lưu policy “${name}”. Chưa agent nào bị thay đổi quyền: hãy gán policy cho agent.`;
    },
    onSuccess: onSaved,
  });

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setAsset = (key: string, patch: Partial<AssetForm>) =>
    setForm((f) => ({ ...f, assets: { ...f.assets, [key]: { ...(f.assets[key] ?? OFF), ...patch } } }));
  const people = [...book, ...extra.filter((x) => !book.some((c) => c.id === x.id))];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <form
        id="policy-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex min-w-0 flex-col gap-6"
        aria-label={initial ? `Sửa policy ${initial.name}` : "Tạo policy"}
      >
        <Card title={initial ? `Sửa policy: ${initial.name}` : "Tạo policy"}>
          <p className="text-sm text-muted">
            Policy là một bộ quyền và giới hạn có tên. Lưu policy chưa thay đổi quyền của agent nào; sau đó
            gán cho agent và ký các thay đổi bằng ví chủ để vault cưỡng chế nó.
          </p>
          {initial ? null : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Bắt đầu từ mẫu</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TEMPLATES.map((t) => (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer flex-col gap-1 rounded-[14px] border p-3 text-sm ${
                      template === t.id ? "border-accent bg-surface-2" : "border-line"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="policy-template"
                        checked={template === t.id}
                        onChange={() => pickTemplate(t.id)}
                      />
                      {t.name}
                      {t.id === "swap" ? <Pill tone="warn">DEMO</Pill> : null}
                    </span>
                    <span className="text-muted">{t.description}</span>
                  </label>
                ))}
              </div>
              <span className="text-xs text-muted">
                Mẫu chỉ điền sẵn; bạn vẫn sửa được từng quyền bên dưới.
              </span>
            </fieldset>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="pol-name" label="Tên policy">
              <input
                id="pol-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field id="pol-desc" label="Mô tả (không bắt buộc)">
              <input
                id="pol-desc"
                maxLength={300}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={INPUT}
              />
            </Field>
          </div>
        </Card>

        <Step n={1} title="Được dùng tài sản nào, chi bao nhiêu mỗi ngày?">
          <p className="text-sm text-muted">
            Ngân sách tính theo số dư vault giảm trong ngày (UTC), riêng cho từng tài sản. Tài sản không bật
            thì agent không chi được; token vault đang theo dõi mà không có trong policy sẽ bị khoá về 0.
          </p>
          <div className="flex flex-col gap-3">
            {ASSET_ROWS.map((row) => {
              const a = form.assets[row.key] ?? OFF;
              return (
                <div key={row.key} className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      onChange={(e) =>
                        setAsset(row.key, {
                          enabled: e.target.checked,
                          cap: a.cap || "0",
                          threshold: a.threshold || "0",
                        })
                      }
                    />
                    {row.symbol}
                    {row.demo ? <Pill tone="warn">DEMO</Pill> : null}
                  </label>
                  {a.enabled ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field id={`cap-${row.key}`} label={`Ngân sách mỗi ngày (${row.symbol})`}>
                        <input
                          id={`cap-${row.key}`}
                          inputMode="decimal"
                          value={a.cap}
                          onChange={(e) => setAsset(row.key, { cap: e.target.value })}
                          className={INPUT}
                        />
                      </Field>
                      <Field
                        id={`thr-${row.key}`}
                        label={`Cần Guardian ký khi một lần chi vượt (${row.symbol})`}
                        hint="Đặt bằng 0 để mọi khoản chi đều cần verdict."
                      >
                        <input
                          id={`thr-${row.key}`}
                          inputMode="decimal"
                          value={a.threshold}
                          onChange={(e) => setAsset(row.key, { threshold: e.target.value })}
                          className={INPUT}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Step>

        <Step n={2} title="Được gửi tiền cho ai?">
          <p className="text-sm text-muted">
            Chọn từ danh bạ. Có trong danh bạ chỉ để nhận diện; quyền nhận tiền chỉ có khi nằm trong policy
            được áp dụng.
          </p>
          <AddressChecklist
            options={people.map((c) => ({
              address: c.address,
              label: c.name,
              sub: CONTACT_KIND_LABEL[c.kind],
            }))}
            selected={form.recipients}
            onChange={(recipients) => set({ recipients })}
            empty="Danh bạ trống."
            name="recipient"
          />
          <QuickContact
            vault={vault}
            onAdded={(c) => {
              setExtra((xs) => [...xs, c]);
              set({ recipients: toggle(form.recipients, c.address, true) });
            }}
          />
        </Step>

        <Step n={3} title="Được tương tác với contract nào, làm gì?">
          <p className="text-sm text-muted">
            Contract và thao tác là quyền riêng, khác với người nhận tiền. Chỉ thao tác được chọn mới chạy
            được.
          </p>
          <div className="flex flex-col gap-3">
            {CONTRACTS.map((c) => {
              const chosen = form.contracts.find((x) => x.address === c.address)?.selectors ?? [];
              return (
                <div key={c.address} className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {c.name}
                    {c.demo ? <Pill tone="warn">DEMO</Pill> : null}
                    <span className="font-mono text-xs font-normal text-muted">{c.address}</span>
                  </span>
                  {c.functions.map((fn) => (
                    <label key={fn.selector} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={chosen.includes(fn.selector)}
                        onChange={(e) => {
                          const next = toggle(chosen, fn.selector, e.target.checked);
                          set({
                            contracts: [
                              ...form.contracts.filter((x) => x.address !== c.address),
                              ...(next.length ? [{ address: c.address, selectors: next }] : []),
                            ],
                          });
                        }}
                      />
                      <span>
                        <span className="font-mono text-xs">{fn.name}</span>{" "}
                        <span className="text-muted">— {fn.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
            {form.contracts
              .filter((x) => !CONTRACTS.some((c) => c.address === x.address))
              .map((x) => (
                <div
                  key={x.address}
                  className="flex flex-wrap items-center gap-2 rounded-[18px] bg-surface-2 p-4 text-sm"
                >
                  <span className="font-mono text-xs break-all">{x.address}</span>
                  <span className="font-mono text-xs text-muted">{x.selectors.join(", ")}</span>
                  <Button
                    variant="secondary"
                    type="button"
                    onPress={() => set({ contracts: form.contracts.filter((y) => y.address !== x.address) })}
                  >
                    Bỏ
                  </Button>
                </div>
              ))}
            <OtherContract
              onAdd={(address, selector) => {
                const have = form.contracts.find((x) => x.address.toLowerCase() === address.toLowerCase());
                set({
                  contracts: [
                    ...form.contracts.filter((x) => x !== have),
                    {
                      address: have?.address ?? address,
                      selectors: [...new Set([...(have?.selectors ?? []), selector])],
                    },
                  ],
                });
              }}
            />
          </div>
        </Step>

        <Step n={4} title="Được cấp quyền chi tiêu (approval) cho ai, tối đa bao nhiêu?">
          <p className="text-sm text-muted">
            Ví dụ cho sàn rút USDC khi swap. Mọi approval đều cần verdict Guardian và bị vault thu hồi ngay
            sau giao dịch. Trên vault hiện tại, bên nhận quyền dùng chung danh sách với người nhận tiền.
          </p>
          <AddressChecklist
            options={[
              ...CONTRACTS.map((c) => ({ address: c.address, label: c.name, sub: "Contract" })),
              ...people
                .filter((p) => !CONTRACTS.some((c) => c.address === p.address))
                .map((c) => ({ address: c.address, label: c.name, sub: CONTACT_KIND_LABEL[c.kind] })),
            ]}
            selected={form.spenders}
            onChange={(spenders) => set({ spenders })}
            empty="Chưa có địa chỉ nào để chọn."
            name="spender"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ASSET_ROWS.filter((r) => r.token !== "native" && form.assets[r.key]?.enabled).map((row) => (
              <Field key={row.key} id={`appr-${row.key}`} label={`Cấp quyền tối đa mỗi lần (${row.symbol})`}>
                <input
                  id={`appr-${row.key}`}
                  inputMode="decimal"
                  value={form.assets[row.key]?.maxApproval ?? "0"}
                  onChange={(e) => setAsset(row.key, { maxApproval: e.target.value })}
                  className={INPUT}
                />
              </Field>
            ))}
          </div>
        </Step>

        <Step n={5} title="Khi có verdict, chấp nhận mức rủi ro nào?">
          <p className="text-sm text-muted">
            Ngưỡng cần verdict đặt ở bước 1. Rủi ro do bộ luật của Guardian chấm (không phải AI); vault từ
            chối verdict có rủi ro cao hơn mức này.
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Mức rủi ro tối đa">
            {([0, 1, 2] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="max-risk"
                  checked={form.maxRisk === r}
                  onChange={() => set({ maxRisk: r })}
                />
                {r === 0
                  ? "Chỉ rủi ro THẤP (khuyên dùng)"
                  : r === 1
                    ? "Đến TRUNG BÌNH"
                    : "Cả rủi ro CAO (không khuyên dùng)"}
              </label>
            ))}
          </div>
        </Step>
      </form>

      <aside className="flex min-w-0 flex-col gap-6" aria-label="Xem lại và lưu policy">
        <Card title="Xem lại: tóm tắt">
          {spec ? (
            <>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
                {summarize(spec, names).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {specWarnings(spec, names).length ? (
                <div
                  role="status"
                  className="flex flex-col gap-1 rounded-lg bg-medium-bg p-3 text-sm text-medium"
                >
                  {specWarnings(spec, names).map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p role="alert" className="text-sm text-high">
              {specError}
            </p>
          )}
        </Card>
        {spec ? <TryPolicy spec={spec} people={people} /> : null}
        <Card title={initial ? "Lưu phiên bản mới" : "Lưu policy"}>
          {initial ? (
            <Field id="pol-note" label="Ghi chú cho phiên bản mới (không bắt buộc)">
              <input
                id="pol-note"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={INPUT}
              />
            </Field>
          ) : null}
          <FormError error={save.error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" type="submit" form="policy-form" isDisabled={save.isPending || !spec}>
              {save.isPending ? "Đang lưu…" : initial ? "Lưu thay đổi" : "Lưu policy"}
            </Button>
            <Button variant="secondary" type="button" onPress={onCancel}>
              Huỷ
            </Button>
            <span className="text-sm text-muted">
              Lưu không thay đổi quyền của agent nào; gán policy cho agent ở tab Policy.
            </span>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="h3-panel flex flex-col gap-3">
      <h3 id={`step-${n}`} className="flex items-start gap-3 text-base font-bold">
        <span
          aria-hidden="true"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm text-accent-fg"
        >
          {n}
        </span>
        <span className="pt-0.5 text-balance">{title}</span>
      </h3>
      {children}
    </section>
  );
}

function AddressChecklist({
  options,
  selected,
  onChange,
  empty,
  name,
}: {
  options: { address: Address; label: string; sub: string }[];
  selected: Address[];
  onChange: (next: Address[]) => void;
  empty: string;
  name: string;
}) {
  const unknown = selected.filter((a) => !options.some((o) => o.address.toLowerCase() === a.toLowerCase()));
  if (!options.length && !unknown.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {[...options, ...unknown.map((a) => ({ address: a, label: "Ngoài danh bạ", sub: "" }))].map((o) => (
        <li key={`${name}-${o.address}`}>
          <label className="flex min-w-0 items-start gap-2 rounded-[14px] border border-line p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.some((a) => a.toLowerCase() === o.address.toLowerCase())}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, o.address]
                    : selected.filter((a) => a.toLowerCase() !== o.address.toLowerCase()),
                )
              }
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">
                {o.label} {o.sub ? <span className="font-normal text-muted">· {o.sub}</span> : null}
              </span>
              <span className="font-mono text-xs break-all text-muted">{o.address}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Adds an address through the address book, so the lookalike check runs before it can be chosen. */
function QuickContact({ vault, onAdded }: { vault: string; onAdded: (c: Contact) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const add = useMutation({
    mutationFn: () =>
      wsApi<{ contact: Contact }>(vault, "contacts", "POST", {
        name,
        address: address.trim(),
        kind: "recipient",
      }),
    onSuccess: (r) => {
      onAdded({ ...r.contact, allowlisted: { recipient: false, target: false } });
      setName("");
      setAddress("");
      setOpen(false);
    },
  });
  if (!open)
    return (
      <Button variant="secondary" type="button" className="self-start" onPress={() => setOpen(true)}>
        Thêm người nhận mới vào danh bạ
      </Button>
    );
  const lookalike = add.error instanceof AccountApiError && add.error.code === "lookalike";
  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="qc-name" label="Tên">
          <input
            id="qc-name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field id="qc-address" label="Địa chỉ (0x…)">
          <input
            id="qc-address"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`${INPUT} font-mono`}
          />
        </Field>
      </div>
      {lookalike ? (
        <p role="alert" className="text-sm text-high">
          {errorOf(add.error)} Nếu chắc chắn đúng, hãy xác nhận ở tab Danh bạ.
        </p>
      ) : (
        <FormError error={add.error} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="button"
          isDisabled={add.isPending || !name || !address}
          onPress={() => add.mutate()}
        >
          Lưu và chọn
        </Button>
        <Button variant="secondary" type="button" onPress={() => setOpen(false)}>
          Đóng
        </Button>
      </div>
    </div>
  );
}

/** Any other contract, by address and function signature (e.g. "deposit(uint256)") or 4-byte selector. */
function OtherContract({ onAdd }: { onAdd: (address: Address, selector: Hex) => void }) {
  const [address, setAddress] = useState("");
  const [fn, setFn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const a = address.trim();
    const f = fn.trim();
    if (!isAddress(a)) return setError("Địa chỉ contract không hợp lệ.");
    let selector: Hex;
    try {
      selector = /^0x[0-9a-fA-F]{8}$/.test(f)
        ? (f.toLowerCase() as Hex)
        : toFunctionSelector(f.startsWith("function ") ? f : `function ${f}`);
    } catch {
      return setError("Nhập chữ ký hàm như deposit(uint256) hoặc selector 0x12345678.");
    }
    setError(null);
    onAdd(a, selector);
    setFn("");
  };
  return (
    <details className="rounded-[18px] border border-line p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Contract khác (nâng cao)</summary>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="oc-address" label="Địa chỉ contract">
          <input
            id="oc-address"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`${INPUT} font-mono`}
          />
        </Field>
        <Field id="oc-fn" label="Thao tác (chữ ký hàm hoặc selector)">
          <input
            id="oc-fn"
            spellCheck={false}
            placeholder="deposit(uint256)"
            value={fn}
            onChange={(e) => setFn(e.target.value)}
            className={`${INPUT} font-mono`}
          />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-high">
          {error}
        </p>
      ) : null}
      <Button variant="secondary" type="button" className="mt-3" onPress={add}>
        Thêm thao tác
      </Button>
    </details>
  );
}

// ------------------------------------------------------------------ Thử policy

const OUTCOME: Record<Outcome["result"], { label: string; tone: "ok" | "warn" | "high" }> = {
  allowed: { label: "Trong giới hạn", tone: "ok" },
  needs_verdict: { label: "Cần verdict Guardian", tone: "warn" },
  blocked: { label: "Bị chặn", tone: "high" },
};

function OutcomeView({ o }: { o: Outcome }) {
  return (
    <div className="flex flex-col gap-1">
      <Pill tone={OUTCOME[o.result].tone}>{OUTCOME[o.result].label}</Pill>
      {o.reasons.map((r) => (
        <span key={r} className="text-xs text-muted">
          {r}
        </span>
      ))}
    </div>
  );
}

function TryPolicy({ spec, people }: { spec: PolicySpec; people: Contact[] }) {
  const names = useMemo(() => naming(people), [people]);
  const examples = exampleScenarios(spec, names);
  const [asset, setAsset] = useState<string>((ASSET_ROWS[0] ?? NATIVE_ROW).key);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("5");
  const [spent, setSpent] = useState("0");
  const row = ASSET_ROWS.find((r) => r.key === asset) ?? NATIVE_ROW;
  let custom: Outcome | null = null;
  let customError: string | null = null;
  if (to) {
    try {
      if (!isAddress(to.trim())) throw new Error("Địa chỉ người nhận không hợp lệ.");
      custom = evaluate(
        spec,
        {
          kind: "transfer",
          asset: row.token,
          to: to.trim() as Address,
          amount: BigInt(units(amount, row.decimals, "Số tiền")),
          spentToday: BigInt(units(spent, row.decimals, "Đã chi hôm nay")),
        },
        names,
      );
    } catch (e) {
      customError = errorOf(e);
    }
  }
  return (
    <Card title="Thử policy">
      <p className="text-xs text-muted">
        Chỉ đối chiếu với cấu hình policy, không mô phỏng giao dịch. Khi chạy thật, Guardian còn mô phỏng trên
        fork và vault kiểm tra số dư thực.
      </p>
      {examples.length ? (
        <ul className="flex flex-col gap-3">
          {examples.map((e) => (
            <li
              key={e.label}
              className="flex flex-col gap-1.5 border-b border-line pb-3 last:border-0 last:pb-0"
            >
              <span className="text-sm font-medium">{e.label}</span>
              <OutcomeView o={evaluate(spec, e.scenario, names)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          Bật một tài sản và chọn ít nhất một người nhận để xem tình huống mẫu.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Tự nhập một khoản chuyển</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field id="try-asset" label="Tài sản">
            <select id="try-asset" value={asset} onChange={(e) => setAsset(e.target.value)} className={INPUT}>
              {ASSET_ROWS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.symbol}
                </option>
              ))}
            </select>
          </Field>
          <Field id="try-to" label="Người nhận" hint="Chọn từ danh bạ hoặc dán địa chỉ.">
            <input
              id="try-to"
              list="try-to-options"
              spellCheck={false}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${INPUT} font-mono`}
            />
            <datalist id="try-to-options">
              {people.map((c) => (
                <option key={c.id} value={c.address}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="try-amount" label={`Số tiền (${row.symbol})`}>
              <input
                id="try-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field id="try-spent" label="Đã chi hôm nay">
              <input
                id="try-spent"
                inputMode="decimal"
                value={spent}
                onChange={(e) => setSpent(e.target.value)}
                className={INPUT}
              />
            </Field>
          </div>
          {custom ? <OutcomeView o={custom} /> : null}
          {customError ? (
            <p role="alert" className="text-high">
              {customError}
            </p>
          ) : null}
        </div>
      </details>
      <p className="text-xs text-muted">Verdict chỉ được chấp nhận khi rủi ro ≤ {RISK_WORD[spec.maxRisk]}.</p>
    </Card>
  );
}
