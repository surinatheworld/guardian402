"use client";
// Policy tab: the owner's policy library, which policy each agent of this vault is assigned, whether the vault
// enforces it, and the owner transactions that apply it. Effective permissions first; changes below.
import { Button } from "@heroui/react/button";
import { Tabs } from "@heroui/react/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Address } from "viem";
import { accountApi } from "@/lib/account";
import { naming, TEMPLATES } from "@/lib/policy-catalog";
import { formatTime } from "@/lib/format";
import { AddressLink, Card, Empty, ErrorBox, Expand, Loading } from "@/components/ui";
import { ConfirmInline, FormError, Pill, errorOf } from "@/components/form";
import {
  AGENT_STATUS_LABEL,
  useAssignments,
  useContacts,
  useInvalidate,
  usePolicies,
  usePolicyChanges,
  wsApi,
  type AssignmentOverview,
  type Assignment,
  type Budget,
  type Enforcement,
  type Policy,
} from "@/lib/workspace";
import { PolicyBuilder } from "./policy-builder";
import { PolicySelect } from "./policy-fields";
import { PolicyPreview } from "./policy-preview";
import { PolicyStageHeader } from "./policy-stage";
import { ChangeItem, useSubmittedPolling } from "./policy";

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit" | "trial"; policy: Policy };

export function PoliciesTab({
  vault,
  vaultLabel,
  ownerWallet,
  onBuilderChange,
  initialAgent,
  onOpenAgents,
}: {
  vault: Address;
  vaultLabel: string;
  ownerWallet: Address;
  onBuilderChange: (open: boolean) => void;
  initialAgent: number | undefined;
  onOpenAgents: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [pane, setPane] = useState<"library" | "deploy">(initialAgent === undefined ? "library" : "deploy");
  const [saved, setSaved] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<number>();
  const [preferredAgent, setPreferredAgent] = useState<number | undefined>(initialAgent);
  const assignments = useAssignments(vault);
  const invalidate = useInvalidate(vault);
  const assignmentHeading = useRef<HTMLHeadingElement>(null);
  const hubHeading = useRef<HTMLHeadingElement>(null);
  const effective = assignments.data?.agents.find((row) => row.enforcement?.state === "active");
  const pending = assignments.data?.agents.find((row) => row.enforcement?.state === "pending");
  const focusHub = () => {
    setMode({ kind: "list" });
    onBuilderChange(false);
    requestAnimationFrame(() => hubHeading.current?.focus());
  };
  const openDeployment = (policyId?: number, agentId?: number, message?: string) => {
    setMode({ kind: "list" });
    onBuilderChange(false);
    setSuggested(policyId);
    setPreferredAgent(agentId);
    setSaved(message ?? null);
    setPane("deploy");
    requestAnimationFrame(() => assignmentHeading.current?.focus());
  };
  if (mode.kind === "trial") {
    return (
      <SavedPolicyTrial
        vault={vault}
        vaultLabel={vaultLabel}
        policy={mode.policy}
        baseline={effective?.assignment ?? undefined}
        budgets={assignments.data?.onChain?.budgets}
        onClose={focusHub}
      />
    );
  }
  if (mode.kind !== "list")
    return (
      <PolicyBuilder
        key={mode.kind === "edit" ? mode.policy.id : "new"}
        vault={vault}
        vaultLabel={vaultLabel}
        initial={mode.kind === "edit" ? mode.policy : undefined}
        baseline={effective?.assignment ?? undefined}
        budgets={assignments.data?.onChain?.budgets}
        onSaved={(result) => {
          void invalidate("policies", "assignments");
          openDeployment(result.policyId, preferredAgent, result.message);
        }}
        onCancel={focusHub}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 ref={hubHeading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
            Bộ quy tắc cho agent
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {assignments.isPending ? (
              <span>Đang đọc két…</span>
            ) : assignments.isError ? (
              <span>Chưa đọc được két. {errorOf(assignments.error)}</span>
            ) : effective?.assignment ? (
              <>
                <Pill tone="ok">Đang áp dụng</Pill>
                <span className="wrap-anywhere">
                  {effective.assignment.policy.name} · {effective.agent.name} · phiên bản{" "}
                  {effective.assignment.version.version}
                </span>
              </>
            ) : pending ? (
              <>
                <Pill tone="warn">Chờ ký</Pill>
                <span>Một bộ quy tắc đang chờ ví chủ két ký để áp dụng.</span>
              </>
            ) : (
              <span>Chưa có bộ quy tắc nào đang áp dụng.</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <Button variant="secondary" onPress={() => openDeployment(undefined, pending.agent.id)}>
              Tiếp tục áp dụng
            </Button>
          ) : null}
          {pane === "library" ? (
            <Button
              variant="primary"
              onPress={() => {
                setSaved(null);
                setMode({ kind: "create" });
                onBuilderChange(true);
              }}
            >
              Tạo bộ quy tắc
            </Button>
          ) : null}
        </div>
      </header>
      <Tabs selectedKey={pane} onSelectionChange={(key) => setPane(key === "deploy" ? "deploy" : "library")}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Bộ quy tắc">
            <Tabs.Tab id="library">
              Thư viện
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="deploy">
              Gán cho agent
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="library" className="p-0 pt-3">
          <Library
            vault={vault}
            onEdit={(policy) => {
              setSaved(null);
              setMode({ kind: "edit", policy });
              onBuilderChange(true);
            }}
            onTrial={(policy) => {
              setMode({ kind: "trial", policy });
              onBuilderChange(true);
            }}
            onDeploy={(policy) => openDeployment(policy.id, preferredAgent)}
          />
        </Tabs.Panel>
        <Tabs.Panel id="deploy" className="p-0 pt-3">
          <AssignmentsCard
            key={`${suggested ?? ""}:${preferredAgent ?? ""}`}
            vault={vault}
            ownerWallet={ownerWallet}
            query={assignments}
            heading={assignmentHeading}
            suggested={suggested}
            preferredAgent={preferredAgent}
            saved={saved}
            onOpenAgents={onOpenAgents}
            onCreatePolicy={() => {
              setSaved(null);
              setMode({ kind: "create" });
              onBuilderChange(true);
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function SavedPolicyTrial({
  vault,
  vaultLabel,
  policy,
  baseline,
  budgets,
  onClose,
}: {
  vault: Address;
  vaultLabel: string;
  policy: Policy;
  baseline: Assignment | undefined;
  budgets: Budget[] | undefined;
  onClose: () => void;
}) {
  const contacts = useContacts(vault).data?.contacts ?? [];
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
    document.getElementById("wizard-preview-title")?.focus({ preventScroll: true });
  }, []);
  const version = `${policy.name} · v${policy.latest.version}`;
  const isEffective = baseline?.policy.id === policy.id && baseline.version.version === policy.latest.version;
  return (
    <div ref={top} className="mx-auto flex w-full max-w-[54rem] min-w-0 scroll-mt-5 flex-col gap-5">
      <PolicyStageHeader
        title="Thử bộ quy tắc đã lưu"
        caption={version}
        vault={vault}
        vaultLabel={vaultLabel}
        exitLabel="Về thư viện"
        onExit={onClose}
      />
      <Card>
        <PolicyPreview
          spec={policy.latest.spec}
          names={naming(contacts)}
          contacts={contacts}
          baseline={baseline}
          budgets={budgets}
          candidateTitle={isEffective ? "Đang áp dụng" : "Bản đã lưu"}
          candidateCaption={version}
          candidateIsEffective={isEffective}
        />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ in force on this vault

function EnforcementPill({ e }: { e: Enforcement }) {
  if (e.state === "active") return <Pill tone="ok">Đang áp dụng trên két</Pill>;
  if (e.state === "unknown") return <Pill>Chưa đọc được két</Pill>;
  if (e.plan.blockers.length) return <Pill tone="high">Chưa áp dụng được</Pill>;
  return (
    <Pill tone="warn">
      {e.submitted ? "Đang chờ xác nhận trên chain" : `Cần chủ ví ký ${e.plan.changes.length} thay đổi`}
    </Pill>
  );
}

function AssignmentsCard({
  vault,
  ownerWallet,
  query: q,
  heading,
  suggested,
  preferredAgent,
  saved,
  onOpenAgents,
  onCreatePolicy,
}: {
  vault: string;
  ownerWallet: Address;
  query: ReturnType<typeof useAssignments>;
  heading: RefObject<HTMLHeadingElement | null>;
  suggested: number | undefined;
  preferredAgent: number | undefined;
  saved: string | null;
  onOpenAgents: () => void;
  onCreatePolicy: () => void;
}) {
  const policies = usePolicies(vault);
  const [selectedAgent, selectAgent] = useState(preferredAgent);
  const agents = q.data?.agents ?? [];
  const selected =
    agents.find((row) => row.agent.id === selectedAgent) ??
    agents.find((row) => row.isOnChainAgent && row.agent.status !== "retired") ??
    agents.find((row) => row.agent.status === "active") ??
    agents[0];
  return (
    <Card>
      <h3
        ref={heading}
        tabIndex={-1}
        className="scroll-mt-4 text-lg font-semibold tracking-tight outline-none"
      >
        Gán cho agent
      </h3>
      {saved ? (
        <p role="status" className="text-sm text-success-soft-foreground wrap-anywhere">
          {saved}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        Chọn agent và bộ quy tắc. Ví chủ két ký các thay đổi để bộ quy tắc được áp dụng.
      </p>
      {q.isPending ? (
        <Loading label="Đang đọc két trên chain…" />
      ) : q.isError ? (
        <ErrorBox
          title="Không đọc được danh sách"
          detail={errorOf(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {!q.data.chain ? (
            <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">
              Chưa đọc được két lúc này (mạng bận). Trạng thái áp dụng sẽ hiện khi đọc lại được.
            </p>
          ) : null}
          {q.data.onChain?.paused ? (
            <p role="status" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
              Két đang khoá: agent không chạy được giao dịch nào, kể cả khi bộ quy tắc đang áp dụng.
            </p>
          ) : null}
          {!selected ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">Thêm agent vào két để gán bộ quy tắc.</p>
              <Button variant="secondary" type="button" onPress={onOpenAgents}>
                Đến tab Agent
              </Button>
            </div>
          ) : (
            <>
              {agents.length > 1 ? (
                <div className="max-w-sm">
                  <PolicySelect
                    label="Agent nhận bộ quy tắc"
                    value={String(selected.agent.id)}
                    options={agents.map(({ agent }) => ({ id: String(agent.id), label: agent.name }))}
                    onChange={(id) => selectAgent(Number(id))}
                  />
                  <p className="mt-1 text-xs text-muted">
                    Vault chỉ có một agent thực thi tại một thời điểm.
                  </p>
                </div>
              ) : null}
              {policies.isPending ? <Loading label="Đang tải bộ quy tắc…" /> : null}
              {policies.isError ? (
                <ErrorBox
                  title="Không tải được bộ quy tắc"
                  detail={errorOf(policies.error)}
                  onRetry={() => void policies.refetch()}
                />
              ) : null}
              {policies.isSuccess && !policies.data.policies.some((p) => !p.archived) ? (
                <Button variant="secondary" type="button" className="self-start" onPress={onCreatePolicy}>
                  Tạo bộ quy tắc cho agent này
                </Button>
              ) : null}
              <AgentAssignment
                key={selected.agent.id}
                vault={vault}
                row={selected}
                policies={(policies.data?.policies ?? []).filter((p) => !p.archived)}
                ownerWallet={ownerWallet}
                suggested={suggested}
              />
            </>
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
  suggested,
}: {
  vault: string;
  row: AssignmentOverview["agents"][number];
  policies: Policy[];
  ownerWallet: Address;
  suggested: number | undefined;
}) {
  const invalidate = useInvalidate(vault);
  const a = row.assignment;
  const [selection, setChoice] = useState<string>();
  const choice =
    selection ??
    (suggested && policies.some((p) => p.id === suggested)
      ? String(suggested)
      : a
        ? String(a.policy.id)
        : "");
  const [showPlan, setShowPlan] = useState(
    (suggested === undefined || suggested === a?.policy.id) && row.enforcement?.state === "pending",
  );
  const [confirmUnassign, setConfirmUnassign] = useState(false);
  const refresh = () => invalidate("assignments", "policies", "policy");
  const assign = useMutation({
    mutationFn: (policy: Policy) =>
      wsApi(vault, "assignments", "POST", {
        agentId: row.agent.id,
        policyId: policy.id,
        version: policy.latest.version,
      }),
    onSuccess: async () => {
      await refresh();
      setShowPlan(true);
      requestAnimationFrame(() => document.getElementById("policy-plan-heading")?.focus());
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
  const selectedPolicy = policies.find((p) => p.id === Number(choice));
  const canAssign =
    !!selectedPolicy &&
    row.agent.status !== "retired" &&
    !assign.isPending &&
    !unassign.isPending &&
    (a === null || selectedPolicy.id !== a.policy.id || selectedPolicy.latest.version > a.version.version);
  const pending = row.enforcement?.state === "pending" ? row.enforcement : undefined;
  const planVisible = !!a && !!pending && showPlan && !assign.isPending;
  return (
    <section
      aria-label={`Bộ quy tắc của ${row.agent.name}`}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold wrap-anywhere">{row.agent.name}</span>
        {row.isOnChainAgent ? <Pill tone="ok">Agent của két trên chain</Pill> : null}
        {row.agent.status !== "active" ? (
          <Pill tone="warn">{AGENT_STATUS_LABEL[row.agent.status]}</Pill>
        ) : null}
      </div>
      <AddressLink address={row.agent.address} />
      {a && row.enforcement ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              <span className="font-semibold wrap-anywhere">{a.policy.name}</span> · v{a.version.version}
            </span>
            <EnforcementPill e={row.enforcement} />
            {outdated ? <Pill>Có phiên bản {a.policy.latestVersion} mới hơn</Pill> : null}
          </div>
          {!planVisible ? (
            <Expand label="Xem quyền đã gán">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                {a.version.summary.map((s) => (
                  <li key={s} className="wrap-anywhere">
                    {s}
                  </li>
                ))}
              </ul>
            </Expand>
          ) : null}
        </div>
      ) : (
        <p className="text-sm">
          <Pill tone="warn">Chưa gán bộ quy tắc</Pill>{" "}
          <span className="text-muted">
            Guardian không duyệt giao dịch cho agent này cho tới khi có bộ quy tắc được áp dụng.
          </span>
        </p>
      )}

      {!planVisible ? (
        <div id="policy-assign-form" tabIndex={-1} className="flex flex-wrap items-end gap-2 outline-none">
          <div className="w-full min-w-0 sm:max-w-xs">
            <PolicySelect
              label={a ? "Chọn phiên bản mới nhất" : "Chọn bộ quy tắc để gán"}
              value={choice}
              disabled={!policies.length || row.agent.status === "retired" || assign.isPending}
              placeholder={policies.length ? "Chọn bộ quy tắc…" : "Chưa có bộ quy tắc nào"}
              onChange={(value) => {
                setChoice(value);
                setShowPlan(false);
              }}
              options={policies.map((p) => ({ id: String(p.id), label: `${p.name} · v${p.latest.version}` }))}
            />
          </div>
          <Button
            variant={canAssign ? "primary" : "secondary"}
            type="button"
            isDisabled={!canAssign}
            onPress={() => {
              if (selectedPolicy) assign.mutate(selectedPolicy);
            }}
          >
            {assign.isPending
              ? "Đang gán…"
              : a && selectedPolicy?.id === a.policy.id && selectedPolicy.latest.version > a.version.version
                ? `Gán phiên bản ${selectedPolicy.latest.version}`
                : "Gán bộ quy tắc"}
          </Button>
          {a && pending ? (
            <Button
              variant="ghost"
              type="button"
              onPress={() => {
                setShowPlan(true);
                requestAnimationFrame(() => document.getElementById("policy-plan-heading")?.focus());
              }}
            >
              Xem kế hoạch ký
            </Button>
          ) : null}
          {a ? (
            confirmUnassign ? (
              <ConfirmInline
                text="Bỏ gán? Két giữ nguyên quy tắc; muốn chặn agent thì gỡ quyền agent ở trang Agent."
                confirmLabel="Bỏ gán"
                pending={unassign.isPending}
                onConfirm={() => unassign.mutate()}
                onCancel={() => setConfirmUnassign(false)}
              />
            ) : (
              <Button variant="ghost" type="button" onPress={() => setConfirmUnassign(true)}>
                Bỏ gán
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      <FormError error={assign.error ?? unassign.error} />
      {a && pending && planVisible ? (
        <>
          <ApplyPanel
            key={a.id}
            vault={vault}
            assignmentId={a.id}
            enforcement={pending}
            ownerWallet={ownerWallet}
          />
          <Button
            variant="ghost"
            type="button"
            className="self-start"
            onPress={() => {
              setShowPlan(false);
              requestAnimationFrame(() => document.getElementById("policy-assign-form")?.focus());
            }}
          >
            Về phần gán
          </Button>
        </>
      ) : null}
    </section>
  );
}

function changeKey(change: { kind: string; params: Record<string, unknown> }) {
  return JSON.stringify([
    change.kind,
    Object.entries(change.params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, typeof value === "string" ? value.toLowerCase() : value]),
  ]);
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
    onSuccess: async () => {
      await invalidate("policy", "assignments");
      requestAnimationFrame(() => document.getElementById("policy-plan-heading")?.focus());
    },
  });
  const { plan } = enforcement;
  const submitted = mine.find((c) => c.status === "submitted");
  const draftKeys = mine.map(changeKey);
  const matchesPlan =
    plan.changes.length === mine.length && plan.changes.every((c) => draftKeys.includes(changeKey(c)));
  const next = submitted ?? (matchesPlan && !plan.blockers.length ? mine[0] : undefined);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="policy-plan-heading" tabIndex={-1} className="scroll-mt-4 font-semibold outline-none">
          {next ? "Giao dịch tiếp theo" : "Kế hoạch ký"}
        </h4>
        {next ? <Pill tone="warn">{submitted ? "Chờ xác nhận" : `Còn ${mine.length} giao dịch`}</Pill> : null}
      </div>
      {next ? null : (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {plan.changes.map((c) => (
            <li key={changeKey(c)} className="wrap-anywhere">
              {c.reason}
            </li>
          ))}
        </ol>
      )}
      {plan.blockers.map((b) => (
        <p key={b} role="alert" className="text-sm text-danger">
          {b}
        </p>
      ))}
      {plan.notes.map((n) => (
        <p key={n} className="text-sm text-muted">
          {n}
        </p>
      ))}
      {next ? null : (
        <p className="text-xs text-muted">
          Ví chủ ký lần lượt. Gỡ quyền trước, cấp quyền sau, đặt agent cuối.
        </p>
      )}
      {changes.isPending ? (
        <Loading label="Đang tải giao dịch cần ký…" />
      ) : changes.isError ? (
        <ErrorBox
          title="Không tải được giao dịch cần ký"
          detail={errorOf(changes.error)}
          onRetry={() => void changes.refetch()}
        />
      ) : next ? (
        <ul aria-label="Giao dịch tiếp theo">
          <ChangeItem
            key={next.id}
            vault={vault}
            change={next}
            ownerWallet={ownerWallet}
            onChanged={() => invalidate("policy", "assignments")}
          />
        </ul>
      ) : (
        <>
          {mine.length && !matchesPlan ? (
            <p role="status" className="text-sm text-warning-soft-foreground">
              Các bản nháp cũ khác kế hoạch hiện tại. Soạn lại từ trạng thái mới nhất của két.
            </p>
          ) : null}
          <Button
            variant="primary"
            type="button"
            className="self-start"
            isDisabled={apply.isPending || plan.blockers.length > 0 || enforcement.submitted > 0}
            onPress={() => apply.mutate()}
          >
            {apply.isPending
              ? "Đang soạn…"
              : `${mine.length ? "Soạn lại" : "Soạn"} ${plan.changes.length} giao dịch để ký`}
          </Button>
        </>
      )}
      {next && plan.changes.length ? (
        <Expand label="Xem các thay đổi còn lại">
          <ol className="list-decimal space-y-1 pl-5">
            {plan.changes.map((c) => (
              <li key={changeKey(c)} className="wrap-anywhere">
                {c.reason}
              </li>
            ))}
          </ol>
        </Expand>
      ) : null}
      <FormError error={apply.error} />
    </div>
  );
}

// ------------------------------------------------------------------ library

function Library({
  vault,
  onEdit,
  onTrial,
  onDeploy,
}: {
  vault: string;
  onEdit: (p: Policy) => void;
  onTrial: (p: Policy) => void;
  onDeploy: (p: Policy) => void;
}) {
  const q = usePolicies(vault);
  const active = (q.data?.policies ?? []).filter((p) => !p.archived);
  const archived = (q.data?.policies ?? []).filter((p) => p.archived);
  return (
    <Card title="Thư viện bộ quy tắc">
      <p className="text-sm text-muted">
        Dùng lại một bộ quy tắc cho nhiều két. Agent giữ phiên bản đã gán khi bạn sửa.
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
        <Empty>Chưa có bộ quy tắc nào. Bấm “Tạo bộ quy tắc” và bắt đầu từ một mẫu.</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {active.map((p) => (
            <PolicyItem
              key={p.id}
              vault={vault}
              policy={p}
              onEdit={() => onEdit(p)}
              onTrial={() => onTrial(p)}
              onDeploy={() => onDeploy(p)}
            />
          ))}
        </ul>
      )}
      {archived.length ? (
        <Expand label={<>Đã lưu trữ ({archived.length})</>}>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {archived.map((p) => (
              <li key={p.id}>
                {p.name} · {p.versionCount} phiên bản
              </li>
            ))}
          </ul>
        </Expand>
      ) : null}
    </Card>
  );
}

function PolicyItem({
  vault,
  policy,
  onEdit,
  onTrial,
  onDeploy,
}: {
  vault: string;
  policy: Policy;
  onEdit: () => void;
  onTrial: () => void;
  onDeploy: () => void;
}) {
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
    <li className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold wrap-anywhere">{policy.name}</span>
          <Pill>v{policy.latest.version}</Pill>
          <span className="text-xs text-muted">{TEMPLATES.find((t) => t.id === policy.template)?.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" type="button" onPress={onTrial} aria-label={`Thử ${policy.name}`}>
            Thử
          </Button>
          <Button variant="ghost" type="button" onPress={onEdit} aria-label={`Chỉnh sửa ${policy.name}`}>
            Chỉnh sửa
          </Button>
          <Button variant="secondary" type="button" onPress={onDeploy} aria-label={`Gán ${policy.name}`}>
            Gán
          </Button>
        </div>
      </div>
      {policy.description ? <p className="text-sm text-muted wrap-anywhere">{policy.description}</p> : null}
      <p className="text-sm text-muted wrap-anywhere">
        {policy.assignments.length
          ? `Đang gán cho: ${policy.assignments.map((x) => `${x.agentName} (phiên bản ${x.version})`).join(", ")}`
          : "Chưa gán cho agent nào."}
      </p>
      <Expand label="Xem quyền và lịch sử">
        <ul className="mb-3 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {policy.latest.summary.map((s) => (
            <li key={s} className="wrap-anywhere">
              {s}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            type="button"
            aria-expanded={history}
            onPress={() => setHistory((x) => !x)}
          >
            {history ? "Ẩn lịch sử" : `Lịch sử (${policy.versionCount})`}
          </Button>
          {confirm ? (
            <ConfirmInline
              text="Lưu trữ bộ quy tắc này?"
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
            <ol className="mt-3 flex flex-col gap-2">
              {(versions.data.policy.versions ?? []).map((v) => (
                <li key={v.id} className="border-t border-border py-3 text-sm wrap-anywhere">
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
      </Expand>
    </li>
  );
}
