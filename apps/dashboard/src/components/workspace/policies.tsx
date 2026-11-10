"use client";
// Policy tab: the owner's policy library, which policy each agent of this vault is assigned, whether the vault
// enforces it, and the owner transactions that apply it. Effective permissions first; changes below.
import { Button } from "@heroui/react/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { accountApi } from "@/lib/account";
import { TEMPLATES } from "@/lib/policy-catalog";
import { formatTime } from "@/lib/format";
import { AddressLink, Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { ConfirmInline, FormError, INPUT, Pill, errorOf } from "@/components/form";
import {
  AGENT_STATUS_LABEL,
  useAssignments,
  useInvalidate,
  usePolicies,
  usePolicyChanges,
  wsApi,
  type AssignmentOverview,
  type Budget,
  type Enforcement,
  type Policy,
} from "@/lib/workspace";
import { PolicyBuilder } from "./policy-builder";
import { ChangeItem, useSubmittedPolling } from "./policy";

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; policy: Policy };

export function PoliciesTab({ vault, ownerWallet }: { vault: string; ownerWallet: Address }) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [message, setMessage] = useState<string | null>(null);
  const invalidate = useInvalidate(vault);
  if (mode.kind !== "list")
    return (
      <PolicyBuilder
        key={mode.kind === "edit" ? mode.policy.id : "new"}
        vault={vault}
        {...(mode.kind === "edit" ? { initial: mode.policy } : {})}
        onSaved={(m) => {
          setMessage(m);
          setMode({ kind: "list" });
          void invalidate("policies", "assignments");
        }}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {message ? (
        <p role="status" className="rounded-lg bg-low-bg p-3 text-sm text-low">
          {message}
        </p>
      ) : null}
      <AssignmentsCard vault={vault} ownerWallet={ownerWallet} />
      <Library
        vault={vault}
        onCreate={() => {
          setMessage(null);
          setMode({ kind: "create" });
        }}
        onEdit={(policy) => {
          setMessage(null);
          setMode({ kind: "edit", policy });
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ in force on this vault

function BudgetMeter({ b }: { b: Budget }) {
  const cap = BigInt(b.dailyCap);
  const spent = BigInt(b.spentToday);
  const pct = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;
  const text = `${formatUnits(spent, b.decimals)} / ${formatUnits(cap, b.decimals)} ${b.symbol}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{b.symbol}</span>
        <span className="tabular-nums text-muted">Đã chi {text}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label={`Ngân sách ${b.symbol} đã dùng hôm nay`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={text}
      >
        <div
          className={`h-full rounded-full ${pct >= 80 ? "bg-medium" : "bg-low"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function EnforcementPill({ e }: { e: Enforcement }) {
  if (e.state === "active") return <Pill tone="ok">Đang hiệu lực trên vault</Pill>;
  if (e.state === "unknown") return <Pill>Chưa đọc được vault</Pill>;
  if (e.plan.blockers.length) return <Pill tone="high">Chưa áp dụng được</Pill>;
  return (
    <Pill tone="warn">
      {e.submitted ? "Đang chờ xác nhận trên chain" : `Cần chủ ví ký ${e.plan.changes.length} thay đổi`}
    </Pill>
  );
}

function AssignmentsCard({ vault, ownerWallet }: { vault: string; ownerWallet: Address }) {
  const q = useAssignments(vault);
  const policies = usePolicies(vault);
  return (
    <Card title="Agent và policy trên vault này">
      <p className="text-sm text-muted">
        Mỗi agent dùng một policy. Policy chỉ có hiệu lực khi cấu hình vault trên chain khớp với nó và agent
        là agent của vault; trạng thái dưới đây đọc trực tiếp từ vault.
      </p>
      {q.isPending ? (
        <Loading label="Đang đọc cấu hình vault trên chain…" />
      ) : q.isError ? (
        <ErrorBox
          title="Không đọc được danh sách"
          detail={errorOf(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {!q.data.chain ? (
            <p role="status" className="rounded-lg bg-medium-bg p-3 text-sm text-medium">
              Không đọc được vault lúc này (RPC bận). Trạng thái hiệu lực sẽ hiện khi đọc lại được.
            </p>
          ) : null}
          {q.data.onChain?.paused ? (
            <p role="status" className="rounded-lg bg-high-bg p-3 text-sm text-high">
              Vault đang tạm dừng: không agent nào chạy được giao dịch, kể cả khi policy đang hiệu lực.
            </p>
          ) : null}
          {q.data.onChain ? (
            <div className="grid grid-cols-1 gap-3 rounded-[18px] bg-surface-2 p-4 sm:grid-cols-2">
              <p className="text-sm font-semibold sm:col-span-2">
                Ngân sách hôm nay (UTC), chung cho cả vault
              </p>
              {q.data.onChain.budgets.filter((b) => BigInt(b.dailyCap) > 0n).length ? (
                q.data.onChain.budgets
                  .filter((b) => BigInt(b.dailyCap) > 0n)
                  .map((b) => <BudgetMeter key={String(b.token)} b={b} />)
              ) : (
                <p className="text-sm text-muted sm:col-span-2">Vault chưa cho chi tài sản nào.</p>
              )}
            </div>
          ) : null}
          {q.data.agents.length === 0 ? (
            <Empty>Chưa có agent nào. Thêm agent ở tab Agent trước khi gán policy.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {q.data.agents.map((row) => (
                <AgentAssignment
                  key={row.agent.id}
                  vault={vault}
                  row={row}
                  policies={(policies.data?.policies ?? []).filter((p) => !p.archived)}
                  ownerWallet={ownerWallet}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function AgentAssignment({
  vault,
  row,
  policies,
  ownerWallet,
}: {
  vault: string;
  row: AssignmentOverview["agents"][number];
  policies: Policy[];
  ownerWallet: Address;
}) {
  const invalidate = useInvalidate(vault);
  const a = row.assignment;
  const [choice, setChoice] = useState<string>(a ? String(a.policy.id) : "");
  const [showPlan, setShowPlan] = useState(false);
  const [confirmUnassign, setConfirmUnassign] = useState(false);
  const refresh = () => invalidate("assignments", "policies", "policy");
  const assign = useMutation({
    mutationFn: (version?: number) =>
      wsApi(vault, "assignments", "POST", {
        agentId: row.agent.id,
        policyId: Number(choice || a?.policy.id),
        ...(version ? { version } : {}),
      }),
    onSuccess: () => {
      setShowPlan(true);
      void refresh();
    },
  });
  const unassign = useMutation({
    mutationFn: () => wsApi(vault, `agents/${row.agent.id}/policy`, "DELETE"),
    onSuccess: () => {
      setConfirmUnassign(false);
      void refresh();
    },
  });
  const outdated = a && a.version.version < a.policy.latestVersion;
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{row.agent.name}</span>
        {row.isOnChainAgent ? <Pill tone="ok">Agent của vault trên chain</Pill> : null}
        {row.agent.status !== "active" ? (
          <Pill tone="warn">{AGENT_STATUS_LABEL[row.agent.status]}</Pill>
        ) : null}
      </div>
      <AddressLink address={row.agent.address} />
      {a && row.enforcement ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Policy: <span className="font-semibold">{a.policy.name}</span> · phiên bản {a.version.version}
            </span>
            <EnforcementPill e={row.enforcement} />
            {outdated ? <Pill>Có phiên bản {a.policy.latestVersion} mới hơn</Pill> : null}
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {a.version.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm">
          <Pill tone="warn">Chưa gán policy</Pill>{" "}
          <span className="text-muted">
            Guardian không cấp verdict cho agent này cho tới khi có policy hiệu lực.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {a ? "Đổi sang policy" : "Gán policy"}
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className={`${INPUT} sm:w-72`}
            aria-label={`Policy cho ${row.agent.name}`}
          >
            <option value="">Chọn policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (phiên bản {p.latest.version})
              </option>
            ))}
          </select>
        </label>
        <Button
          variant={a ? "secondary" : "primary"}
          type="button"
          isDisabled={
            !choice || assign.isPending || (a !== null && Number(choice) === a.policy.id && !outdated)
          }
          onPress={() => assign.mutate(undefined)}
        >
          {a && Number(choice) === a.policy.id && outdated
            ? `Chuyển sang phiên bản ${a.policy.latestVersion}`
            : "Gán"}
        </Button>
        {a && row.enforcement?.state === "pending" ? (
          <Button variant="primary" type="button" onPress={() => setShowPlan((x) => !x)}>
            {showPlan ? "Ẩn các thay đổi cần ký" : "Áp dụng lên vault"}
          </Button>
        ) : null}
        {a ? (
          confirmUnassign ? (
            <ConfirmInline
              text="Bỏ gán? Vault giữ nguyên cấu hình; muốn chặn agent thì thu hồi agent ở tab Agent."
              confirmLabel="Bỏ gán"
              pending={unassign.isPending}
              onConfirm={() => unassign.mutate()}
              onCancel={() => setConfirmUnassign(false)}
            />
          ) : (
            <Button variant="secondary" type="button" onPress={() => setConfirmUnassign(true)}>
              Bỏ gán
            </Button>
          )
        ) : null}
      </div>
      <FormError error={assign.error ?? unassign.error} />
      {a && showPlan && row.enforcement?.state === "pending" ? (
        <ApplyPanel
          vault={vault}
          assignmentId={a.id}
          enforcement={row.enforcement}
          ownerWallet={ownerWallet}
        />
      ) : null}
    </li>
  );
}

function ApplyPanel({
  vault,
  assignmentId,
  enforcement,
  ownerWallet,
}: {
  vault: string;
  assignmentId: number;
  enforcement: Extract<Enforcement, { state: "pending" }>;
  ownerWallet: Address;
}) {
  const changes = usePolicyChanges(vault);
  const invalidate = useInvalidate(vault);
  useSubmittedPolling(vault, changes.data?.changes);
  // In the order of the plan (drafted in that order): permissions removed first, the agent last.
  const mine = (changes.data?.changes ?? [])
    .filter((c) => c.assignmentId === assignmentId && (c.status === "draft" || c.status === "submitted"))
    .sort((x, y) => x.id - y.id);
  const apply = useMutation({
    mutationFn: () => wsApi(vault, `assignments/${assignmentId}/apply`, "POST"),
    onSuccess: () => invalidate("policy", "assignments"),
  });
  const { plan } = enforcement;
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4">
      <p className="font-semibold">Các thay đổi chủ ví cần ký để vault cưỡng chế policy này</p>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
        {plan.changes.map((c) => (
          <li key={`${c.kind}-${JSON.stringify(c.params)}`}>{c.reason}</li>
        ))}
      </ol>
      {plan.blockers.map((b) => (
        <p key={b} role="alert" className="text-sm text-high">
          {b}
        </p>
      ))}
      {plan.notes.map((n) => (
        <p key={n} className="text-sm text-muted">
          {n}
        </p>
      ))}
      <p className="text-xs text-muted">
        Thứ tự: gỡ quyền trước, cấp quyền sau, đặt agent cuối cùng. Mỗi dòng là một giao dịch ký bằng ví chủ;
        server kiểm tra từng giao dịch trên chain.
      </p>
      {mine.length ? (
        <ol className="flex flex-col gap-3" aria-label="Giao dịch cần ký, theo thứ tự">
          {mine.map((c, i) => (
            <ChangeItem
              step={`Bước ${i + 1}/${mine.length}`}
              key={c.id}
              vault={vault}
              change={c}
              ownerWallet={ownerWallet}
              onChanged={() => invalidate("policy", "assignments")}
            />
          ))}
        </ol>
      ) : (
        <Button
          variant="primary"
          type="button"
          className="self-start"
          isDisabled={apply.isPending || plan.blockers.length > 0}
          onPress={() => apply.mutate()}
        >
          {apply.isPending ? "Đang soạn…" : `Soạn ${plan.changes.length} giao dịch để ký`}
        </Button>
      )}
      <FormError error={apply.error} />
    </div>
  );
}

// ------------------------------------------------------------------ library

function Library({
  vault,
  onCreate,
  onEdit,
}: {
  vault: string;
  onCreate: () => void;
  onEdit: (p: Policy) => void;
}) {
  const q = usePolicies(vault);
  const active = (q.data?.policies ?? []).filter((p) => !p.archived);
  const archived = (q.data?.policies ?? []).filter((p) => p.archived);
  return (
    <Card
      title="Thư viện policy"
      actions={
        <Button variant="primary" type="button" onPress={onCreate}>
          Tạo policy
        </Button>
      }
    >
      <p className="text-sm text-muted">
        Policy thuộc tài khoản của bạn và dùng lại được cho agent ở mọi vault bạn quản lý. Sửa quy tắc tạo
        phiên bản mới; agent giữ phiên bản cũ cho tới khi bạn chuyển.
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBox
          title="Không đọc được thư viện"
          detail={errorOf(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : active.length === 0 ? (
        <Empty>Chưa có policy nào. Bấm “Tạo policy” và bắt đầu từ một mẫu.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((p) => (
            <PolicyItem key={p.id} vault={vault} policy={p} onEdit={() => onEdit(p)} />
          ))}
        </ul>
      )}
      {archived.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Đã lưu trữ ({archived.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {archived.map((p) => (
              <li key={p.id}>
                {p.name} · {p.versionCount} phiên bản
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function PolicyItem({ vault, policy, onEdit }: { vault: string; policy: Policy; onEdit: () => void }) {
  const invalidate = useInvalidate(vault);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState(false);
  const archive = useMutation({
    mutationFn: () => accountApi(`/api/policies/${policy.id}`, "DELETE"),
    onSuccess: () => invalidate("policies"),
  });
  const versions = useQuery({
    queryKey: ["workspace", vault.toLowerCase(), "policies", policy.id, policy.versionCount],
    queryFn: () => accountApi<{ policy: Policy }>(`/api/policies/${policy.id}?vault=${vault}`),
    enabled: history,
  });
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{policy.name}</span>
        <Pill>Phiên bản {policy.latest.version}</Pill>
        <span className="text-xs text-muted">{TEMPLATES.find((t) => t.id === policy.template)?.name}</span>
      </div>
      {policy.description ? <p className="text-sm text-muted">{policy.description}</p> : null}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {policy.latest.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        {policy.assignments.length
          ? `Đang gán cho: ${policy.assignments.map((x) => `${x.agentName} (phiên bản ${x.version})`).join(", ")}`
          : "Chưa gán cho agent nào."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" type="button" onPress={onEdit}>
          Sửa
        </Button>
        <Button variant="secondary" type="button" onPress={() => setHistory((x) => !x)}>
          {history ? "Ẩn lịch sử" : `Lịch sử (${policy.versionCount})`}
        </Button>
        {confirm ? (
          <ConfirmInline
            text="Lưu trữ policy này?"
            confirmLabel="Lưu trữ"
            pending={archive.isPending}
            onConfirm={() => archive.mutate()}
            onCancel={() => setConfirm(false)}
          />
        ) : (
          <Button
            variant="secondary"
            type="button"
            isDisabled={policy.assignments.length > 0}
            onPress={() => setConfirm(true)}
          >
            Lưu trữ
          </Button>
        )}
      </div>
      <FormError error={archive.error} />
      {history ? (
        versions.isPending ? (
          <Loading />
        ) : versions.isError ? (
          <FormError error={versions.error} />
        ) : (
          <ol className="flex flex-col gap-2">
            {(versions.data.policy.versions ?? []).map((v) => (
              <li key={v.id} className="rounded-[14px] border border-line bg-surface p-3 text-sm">
                <p className="font-semibold">
                  Phiên bản {v.version}{" "}
                  <span className="font-normal text-muted tabular-nums">· {formatTime(v.createdAt)}</span>
                </p>
                {v.note ? <p className="text-muted">Ghi chú: {v.note}</p> : null}
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-muted">
                  {v.summary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </li>
  );
}
