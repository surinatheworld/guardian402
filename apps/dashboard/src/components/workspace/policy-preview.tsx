import { Button } from "@heroui/react/button";
import { useState } from "react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { FormError, Pill } from "@/components/form";
import { shortHex } from "@/lib/format";
import {
  evaluate,
  exampleScenarios,
  type Naming,
  type Outcome,
  type PolicySpec,
  type Scenario,
} from "@/lib/policy-spec";
import type { Assignment, Budget, Contact } from "@/lib/workspace";
import { PolicyInput, PolicySelect } from "./policy-fields";
import { assetRows, NATIVE_ASSET, units, type AssetRow } from "./policy-form";

const ACTIONS = [
  { id: "transfer", label: "Chuyển tiền" },
  { id: "approve", label: "Cấp approval" },
  { id: "call", label: "Gọi contract" },
];

const OUTCOME = {
  allowed: { label: "Qua quy tắc đã xét", tone: "ok" },
  needs_verdict: { label: "Cần Guardian ký", tone: "warn" },
  blocked: { label: "Bị chặn", tone: "high" },
} as const;

const CHECK_LABEL = { allowed: "Đạt", needs_verdict: "Cần ký", blocked: "Không đạt" };

function OutcomeView({ title, caption, outcome }: { title: string; caption?: string; outcome: Outcome }) {
  const { tone, label } = OUTCOME[outcome.result];
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 @min-[28rem]:min-h-11">
        <div className="min-w-0">
          <h4 className="text-sm font-bold">{title}</h4>
          {caption ? <p className="mt-1 text-xs text-muted wrap-anywhere">{caption}</p> : null}
        </div>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {outcome.checks.map((check) => (
          <li key={check.label} className="flex flex-wrap justify-between gap-x-2 gap-y-1 py-2.5 last:pb-0">
            <p className="text-sm font-semibold">{check.label}</p>
            <p
              className={`text-xs font-semibold ${check.status === "blocked" ? "text-high" : check.status === "needs_verdict" ? "text-medium" : "text-muted"}`}
            >
              {CHECK_LABEL[check.status]}
            </p>
            <p className="w-full text-sm text-muted tabular-nums wrap-anywhere">{check.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

type Inputs = {
  action: Scenario["kind"];
  asset: string;
  address: string;
  selector: string;
  amount: string;
  spent: string | undefined;
};

function inputsFor(scenario: Scenario, rows: AssetRow[]): Inputs {
  if (scenario.kind === "call") {
    return {
      action: "call",
      asset: "",
      address: scenario.contract,
      selector: scenario.selector,
      amount: "",
      spent: undefined,
    };
  }
  const asset = (scenario.kind === "transfer" ? scenario.asset : scenario.token).toLowerCase();
  const row = rows.find((r) => r.key === asset) ?? NATIVE_ASSET;
  return {
    action: scenario.kind,
    asset,
    address: scenario.kind === "transfer" ? scenario.to : scenario.spender,
    selector: "",
    amount: formatUnits(scenario.amount, row.decimals),
    spent: scenario.kind === "transfer" ? formatUnits(scenario.spentToday, row.decimals) : undefined,
  };
}

function readScenario(input: Inputs, row: AssetRow, spent: string): Scenario | null {
  const target = input.address.trim();
  if (!target) return null;
  if (!isAddress(target)) throw new Error("Kiểm tra lại địa chỉ.");
  if (input.action === "call") {
    const selector = input.selector.trim();
    if (!selector) return null;
    if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) throw new Error("Selector cần 4 byte, ví dụ 0x12345678.");
    return { kind: "call", contract: target, selector: selector as Hex };
  }
  if (!input.amount.trim()) return null;
  const amount = units(input.amount, row.decimals, "Số tiền");
  if (input.action === "approve") {
    return row.token === "native" ? null : { kind: "approve", token: row.token, spender: target, amount };
  }
  if (!spent.trim()) return null;
  return {
    kind: "transfer",
    asset: row.token,
    to: target,
    amount,
    spentToday: units(spent, row.decimals, "Số đã chi"),
  };
}

function ScenarioSummary({
  scenario,
  row,
  names,
  liveSpent,
}: {
  scenario: Scenario;
  row: AssetRow;
  names: Naming;
  liveSpent: boolean;
}) {
  const name = (address: Address) => names.name(address) ?? shortHex(address);
  if (scenario.kind === "call") {
    return (
      <p className="text-lg font-bold wrap-anywhere">
        Gọi {names.fn?.(scenario.contract, scenario.selector) ?? scenario.selector} trên{" "}
        {name(scenario.contract)}
      </p>
    );
  }
  const amount = formatUnits(scenario.amount, row.decimals);
  if (scenario.kind === "approve") {
    return (
      <p className="text-lg font-bold tabular-nums wrap-anywhere">
        Cấp quyền {amount} {row.symbol} cho {name(scenario.spender)}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-bold tabular-nums wrap-anywhere">
        Chuyển {amount} {row.symbol} cho {name(scenario.to)}
      </p>
      <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{liveSpent ? "Đã chi từ vault" : "Đã chi giả định"}</dt>
          <dd className="font-semibold tabular-nums wrap-anywhere">
            {formatUnits(scenario.spentToday, row.decimals)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Khoản thử</dt>
          <dd className="font-semibold tabular-nums wrap-anywhere">+{amount}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Tổng dự kiến</dt>
          <dd className="font-bold tabular-nums wrap-anywhere">
            {formatUnits(scenario.spentToday + scenario.amount, row.decimals)} {row.symbol}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PolicyPreview({
  spec,
  names,
  contacts,
  baseline,
  budgets,
  candidateTitle = "Bản nháp",
  candidateCaption,
  candidateIsEffective = false,
}: {
  spec: PolicySpec;
  names: Naming;
  contacts: Contact[];
  baseline: Assignment | undefined;
  budgets: Budget[] | undefined;
  candidateTitle?: string;
  candidateCaption?: string;
  candidateIsEffective?: boolean;
}) {
  const rows = assetRows(spec, ...(baseline ? [baseline.version.spec] : []));
  const draftExamples = exampleScenarios(spec);
  const examples =
    !draftExamples.length && baseline ? exampleScenarios(baseline.version.spec) : draftExamples;
  const first = examples[0];
  const [input, setInput] = useState<Inputs>(() =>
    first
      ? inputsFor(first.scenario, rows)
      : {
          action: "transfer",
          asset: spec.tokens[0]?.token.toLowerCase() ?? "native",
          address: "",
          selector: "",
          amount: "",
          spent: undefined,
        },
  );
  const [editing, setEditing] = useState(!first);
  const options = rows.filter((r) => input.action !== "approve" || r.token !== "native");
  const row = options.find((r) => r.key === input.asset) ?? options[0] ?? NATIVE_ASSET;
  const onChainSpent = budgets?.find((b) => b.token.toLowerCase() === row.key)?.spentToday;
  const liveSpent = input.spent === undefined && onChainSpent !== undefined;
  const spent =
    input.spent ?? (onChainSpent === undefined ? "0" : formatUnits(BigInt(onChainSpent), row.decimals));

  const change = (patch: Partial<Inputs>) => {
    setInput((prev) => ({ ...prev, ...patch }));
  };
  let scenario: Scenario | null = null;
  let error: unknown = null;
  try {
    scenario = readScenario(input, row, spent);
  } catch (err) {
    error = err;
  }
  const previewNames: Naming = {
    ...names,
    asset: (token) => rows.find((asset) => asset.key === token.toLowerCase()) ?? names.asset(token),
  };
  const draft = scenario ? evaluate(spec, scenario, previewNames) : null;
  const current =
    scenario && baseline && !candidateIsEffective
      ? evaluate(baseline.version.spec, scenario, previewNames)
      : null;

  return (
    <section aria-labelledby="wizard-preview-title" className="@container flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="wizard-preview-title" tabIndex={-1} className="scroll-mt-5 text-base font-bold outline-none">
          Phòng thử policy
        </h3>
        <p className="text-xs text-muted">Đối chiếu cấu hình · Chưa mô phỏng trên fork</p>
      </header>
      {examples.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tình huống mẫu">
          {examples.map(({ label, scenario: sample }) => {
            const isPicked = scenario !== null && sameScenario(scenario, sample);
            return (
              <Button
                key={label}
                type="button"
                variant="secondary"
                aria-pressed={isPicked}
                className={`min-h-[42px] border ${isPicked ? "border-accent text-fg" : "border-transparent text-muted"}`}
                onPress={() => {
                  setInput(inputsFor(sample, rows));
                  setEditing(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
        {scenario ? (
          <ScenarioSummary scenario={scenario} row={row} names={names} liveSpent={liveSpent} />
        ) : (
          <p className="text-sm text-muted">Nhập thông số để xem kết quả.</p>
        )}
        <Button
          variant="ghost"
          type="button"
          className="self-start px-0"
          aria-expanded={editing}
          aria-controls="policy-trial-inputs"
          onPress={() => setEditing((open) => !open)}
        >
          {editing ? "Ẩn thông số" : "Chỉnh thông số"}
        </Button>
        <div id="policy-trial-inputs" hidden={!editing}>
          <div className="grid gap-3 border-t border-line pt-3 @min-[28rem]:grid-cols-2">
            <PolicySelect
              label="Hành động"
              value={input.action}
              options={ACTIONS}
              onChange={(value) =>
                change({
                  action: value as Scenario["kind"],
                  address: "",
                  selector: "",
                  amount: "",
                  spent: undefined,
                })
              }
            />
            {input.action !== "call" ? (
              <PolicySelect
                label="Tài sản"
                value={row.key}
                options={options.map((r) => ({ id: r.key, label: r.symbol }))}
                onChange={(asset) => change({ asset, spent: undefined })}
              />
            ) : null}
            <div className={input.action === "call" ? "" : "@min-[28rem]:col-span-2"}>
              <PolicyInput
                id="preview-address"
                label={
                  input.action === "transfer"
                    ? "Người nhận"
                    : input.action === "approve"
                      ? "Bên nhận approval"
                      : "Địa chỉ contract"
                }
                list="preview-contacts"
                placeholder="0x…"
                spellCheck={false}
                value={input.address}
                onChange={(e) => change({ address: e.target.value })}
              />
              <datalist id="preview-contacts">
                {contacts.map((c) => (
                  <option key={c.id} value={c.address}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </div>
            {input.action === "call" ? (
              <PolicyInput
                id="preview-selector"
                label="Selector"
                placeholder="0x12345678"
                value={input.selector}
                onChange={(e) => change({ selector: e.target.value })}
              />
            ) : (
              <PolicyInput
                id="preview-amount"
                label={`Số tiền (${row.symbol})`}
                inputMode="decimal"
                value={input.amount}
                onChange={(e) => change({ amount: e.target.value })}
              />
            )}
            {input.action === "transfer" ? (
              <div className="flex min-w-0 flex-col gap-1">
                <PolicyInput
                  id="preview-spent"
                  label="Đã chi hôm nay"
                  inputMode="decimal"
                  value={spent}
                  hint={liveSpent ? "Số đọc từ vault trong ngày UTC." : "Số giả định cho tình huống thử."}
                  onChange={(e) => change({ spent: e.target.value })}
                />
                {input.spent !== undefined && onChainSpent !== undefined ? (
                  <Button
                    variant="ghost"
                    type="button"
                    className="self-start px-0"
                    onPress={() => change({ spent: undefined })}
                  >
                    Dùng số từ vault
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <FormError error={error} />
      </div>

      <p role="status" className="sr-only">
        {draft ? `${candidateTitle} · ${OUTCOME[draft.result].label}.` : ""}
        {current ? ` Đang áp dụng: ${OUTCOME[current.result].label}.` : ""}
      </p>
      {draft ? (
        <div className={current ? "grid gap-3 @min-[28rem]:grid-cols-2" : ""}>
          {current && baseline ? (
            <OutcomeView
              title="Đang áp dụng"
              caption={`${baseline.policy.name} · v${baseline.version.version}`}
              outcome={current}
            />
          ) : null}
          <OutcomeView
            title={candidateTitle}
            {...(candidateCaption ? { caption: candidateCaption } : {})}
            outcome={draft}
          />
        </div>
      ) : null}
      {draft && !current && !candidateIsEffective ? (
        <p className="text-xs text-muted">Chưa có policy hiệu lực để so sánh.</p>
      ) : null}
      {draft && scenario?.kind === "call" ? (
        <p className="text-xs text-muted">
          Kết quả chỉ xét quyền gọi hàm. Mức chi và chữ ký phụ thuộc mô phỏng giao dịch.
        </p>
      ) : null}
    </section>
  );
}

function sameScenario(a: Scenario, b: Scenario) {
  if (a.kind === "transfer" && b.kind === "transfer")
    return a.asset === b.asset && a.to === b.to && a.amount === b.amount && a.spentToday === b.spentToday;
  if (a.kind === "approve" && b.kind === "approve")
    return a.token === b.token && a.spender === b.spender && a.amount === b.amount;
  return a.kind === "call" && b.kind === "call" && a.contract === b.contract && a.selector === b.selector;
}
