"use client";
// Agents tab: the AI agents connected to this vault. Each one shows three separate things: its policy (what it
// may do), its Guardian API keys (who may call the API as it), and its wallet authority on the vault (whether
// it can execute at all). Guardian does not run the agent: its model, prompts and schedule stay outside.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { formatTime } from "@/lib/format";
import { AddressLink, Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { ConfirmInline, Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import {
  AGENT_STATUS_LABEL,
  useAgentKeys,
  useAgents,
  useAssignments,
  useInvalidate,
  wsApi,
  type Agent,
  type ApiKey,
  type AssignmentOverview,
} from "@/lib/workspace";

export function AgentsTab({
  vault,
  onOpenPolicy,
  onOpenChanges,
}: {
  vault: string;
  onOpenPolicy: (agentId: number) => void;
  onOpenChanges: () => void;
}) {
  const q = useAgents(vault);
  const overview = useAssignments(vault);
  const invalidate = useInvalidate(vault);
  const [prefill, setPrefill] = useState("");
  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <ErrorBox
        title="Không đọc được danh sách agent"
        detail={errorOf(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const { agents, onChainAgent } = q.data;
  const unregistered = onChainAgent && !agents.some((a) => a.isOnChainAgent);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Agent đang kết nối">
        <p className="text-sm text-muted">
          Kết nối một AI bạn đang chạy ở nơi khác: đăng ký địa chỉ ví thực thi của nó, gán policy, rồi cấp API
          key để nó gọi Guardian. Vault chỉ có một agent thực thi; agent đó do ví chủ đặt trên chain.
        </p>
        {unregistered ? (
          <div className="flex flex-col gap-2 rounded-[18px] bg-medium-bg p-4 text-sm text-medium">
            <p>
              Vault đang cho phép <AddressLink address={onChainAgent} /> thực thi nhưng địa chỉ này chưa có
              trong danh sách.
            </p>
            <Button
              variant="secondary"
              type="button"
              className="self-start"
              onPress={() => setPrefill(onChainAgent)}
            >
              Đăng ký agent này
            </Button>
          </div>
        ) : null}
        {agents.length === 0 ? (
          <Empty>Chưa có agent nào. Đăng ký agent ở bên dưới.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {agents.map((a) => (
              <AgentItem
                key={a.id}
                vault={vault}
                agent={a}
                overview={overview.data?.agents.find((x) => x.agent.id === a.id)}
                onChanged={() => invalidate("agents", "assignments")}
                onOpenPolicy={onOpenPolicy}
                onOpenChanges={onOpenChanges}
              />
            ))}
          </ul>
        )}
      </Card>

      <AddAgent
        key={prefill}
        vault={vault}
        prefill={prefill}
        onAdded={() => invalidate("agents", "assignments")}
      />
    </div>
  );
}

function AgentItem({
  vault,
  agent,
  overview,
  onChanged,
  onOpenPolicy,
  onOpenChanges,
}: {
  vault: string;
  agent: Agent;
  overview: AssignmentOverview["agents"][number] | undefined;
  onChanged: () => void;
  onOpenPolicy: (agentId: number) => void;
  onOpenChanges: () => void;
}) {
  const invalidate = useInvalidate(vault);
  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);
  const update = useMutation({
    mutationFn: (status: Agent["status"]) => wsApi(vault, `agents/${agent.id}`, "PATCH", { status }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => wsApi(vault, `agents/${agent.id}`, "DELETE"),
    onSuccess: onChanged,
  });
  const revokeWallet = useMutation({
    mutationFn: () =>
      wsApi(vault, "policy-changes", "POST", {
        kind: "revoke_agent",
        note: `Thu hồi quyền thực thi của ${agent.name}`,
      }),
    onSuccess: () => {
      setConfirm(null);
      void invalidate("policy");
      onOpenChanges();
    },
  });
  const a = overview?.assignment;
  const e = overview?.enforcement;
  return (
    <li className="flex flex-col gap-4 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{agent.name}</span>
        {agent.isOnChainAgent ? (
          <Pill tone="ok">Được thực thi trên vault</Pill>
        ) : (
          <Pill>Chưa có quyền thực thi</Pill>
        )}
        {agent.status !== "active" ? <Pill tone="warn">{AGENT_STATUS_LABEL[agent.status]}</Pill> : null}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Ví thực thi</span>
        <AddressLink address={agent.address} />
      </div>
      {agent.description ? (
        <p className="text-sm">
          <span className="text-muted">Nhiệm vụ: </span>
          {agent.description}
        </p>
      ) : null}

      <section aria-label="Policy" className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
        <span className="font-semibold">Policy</span>
        {a ? (
          <p className="flex flex-wrap items-center gap-2">
            {a.policy.name} · phiên bản {a.version.version}
            {e?.state === "active" ? (
              <Pill tone="ok">Đang hiệu lực</Pill>
            ) : e?.state === "pending" ? (
              <Pill tone="warn">Chờ chủ ví ký {e.plan.changes.length} thay đổi</Pill>
            ) : (
              <Pill>Chưa đọc được vault</Pill>
            )}
          </p>
        ) : (
          <p className="text-muted">Chưa gán policy: Guardian không cấp verdict cho agent này.</p>
        )}
        <Button
          variant="secondary"
          type="button"
          className="self-start"
          onPress={() => onOpenPolicy(agent.id)}
        >
          {a ? "Xem và đổi policy" : "Gán policy"}
        </Button>
      </section>

      <AgentKeys vault={vault} agent={agent} />

      <section aria-label="Quản lý agent" className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`agent-status-${agent.id}`} label="Trạng thái trong Guardian">
            <select
              id={`agent-status-${agent.id}`}
              value={agent.status}
              disabled={update.isPending}
              onChange={(ev) => update.mutate(ev.target.value as Agent["status"])}
              className={INPUT}
            >
              {Object.entries(AGENT_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {agent.isOnChainAgent ? (
            confirm === "revoke" ? (
              <ConfirmInline
                text="Soạn giao dịch thu hồi quyền thực thi? Ví chủ cần ký."
                confirmLabel="Soạn thu hồi"
                pending={revokeWallet.isPending}
                onConfirm={() => revokeWallet.mutate()}
                onCancel={() => setConfirm(null)}
              />
            ) : (
              <Button variant="danger-soft" type="button" onPress={() => setConfirm("revoke")}>
                Thu hồi quyền ví
              </Button>
            )
          ) : confirm === "delete" ? (
            <ConfirmInline
              text="Xoá agent khỏi danh sách? Policy đang gán và API key của nó cũng bị xoá."
              confirmLabel="Xoá"
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <Button
              variant="secondary"
              type="button"
              onPress={() => {
                remove.reset();
                setConfirm("delete");
              }}
            >
              Xoá
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">
          “Tạm nghỉ” chặn agent gọi Guardian API; “Thu hồi quyền ví” là giao dịch trên vault, chặn agent thực
          thi kể cả khi nó không qua Guardian.
        </p>
      </section>
      <FormError error={update.error ?? remove.error ?? revokeWallet.error} />
    </li>
  );
}

// ------------------------------------------------------------------ API keys and integration

function AgentKeys({ vault, agent }: { vault: string; agent: Agent }) {
  const q = useAgentKeys(vault, agent.id);
  const invalidate = useInvalidate(vault);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () =>
      wsApi<{ key: string; apiKey: ApiKey }>(vault, `agents/${agent.id}/keys`, "POST", { name }),
    onSuccess: (r) => {
      setFresh(r.key);
      setCopied(false);
      setName("");
      void invalidate("keys");
    },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => wsApi(vault, `agents/${agent.id}/keys/${id}`, "DELETE"),
    onSuccess: () => {
      setConfirm(null);
      void invalidate("keys");
    },
  });
  const active = (q.data?.keys ?? []).filter((k) => k.revokedAt === null);
  const revoked = (q.data?.keys ?? []).filter((k) => k.revokedAt !== null);
  return (
    <section aria-label="API key" className="flex flex-col gap-3 border-t border-line pt-3 text-sm">
      <span className="font-semibold">Guardian API key</span>
      <p className="text-muted">
        Hệ thống AI của bạn dùng key để đọc policy, gửi giao dịch nhờ Guardian kiểm tra và lấy verdict. Key
        không đổi được policy hay hạn mức, và không phải khoá ví.
      </p>
      {fresh ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg bg-low-bg p-3 text-low">
          <p className="font-semibold">Key mới, chỉ hiện một lần. Lưu vào biến môi trường của agent.</p>
          <code className="font-mono text-xs break-all text-fg">{fresh}</code>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              onPress={() => {
                navigator.clipboard
                  .writeText(fresh)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? "Đã sao chép" : "Sao chép"}
            </Button>
            <Button variant="secondary" type="button" onPress={() => setFresh(null)}>
              Tôi đã lưu key
            </Button>
          </div>
        </div>
      ) : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <FormError error={q.error} />
      ) : active.length === 0 ? (
        <p className="text-muted">Chưa có key nào đang dùng.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-line bg-surface p-3"
            >
              <span className="font-semibold">{k.name}</span>
              <code className="font-mono text-xs">{k.prefix}…</code>
              <span className="text-xs text-muted tabular-nums">
                Tạo {formatTime(k.createdAt)} ·{" "}
                {k.lastUsedAt ? `dùng gần nhất ${formatTime(k.lastUsedAt)}` : "chưa dùng"}
              </span>
              {confirm === k.id ? (
                <ConfirmInline
                  text="Thu hồi key? Agent dùng key này sẽ không gọi được Guardian API."
                  confirmLabel="Thu hồi key"
                  pending={revoke.isPending}
                  onConfirm={() => revoke.mutate(k.id)}
                  onCancel={() => setConfirm(null)}
                />
              ) : (
                <Button variant="secondary" type="button" onPress={() => setConfirm(k.id)}>
                  Thu hồi key
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revoked.length ? <p className="text-xs text-muted">{revoked.length} key đã thu hồi.</p> : null}
      {agent.status !== "retired" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            create.mutate();
          }}
        >
          <Field id={`key-name-${agent.id}`} label="Tên key (không bắt buộc)">
            <input
              id={`key-name-${agent.id}`}
              maxLength={60}
              placeholder="ví dụ: server production"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              className={`${INPUT} sm:w-64`}
            />
          </Field>
          <Button variant="secondary" type="submit" isDisabled={create.isPending}>
            {create.isPending ? "Đang tạo…" : "Tạo API key"}
          </Button>
        </form>
      ) : null}
      <FormError error={create.error ?? revoke.error} />
      <Integration />
    </section>
  );
}

function Integration() {
  // The dashboard's own origin, without a server/client mismatch on the first render.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const base = `${origin}/api/agent/v1`;
  return (
    <details className="rounded-[14px] border border-line bg-surface p-3">
      <summary className="cursor-pointer font-semibold">Hướng dẫn tích hợp (REST)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-muted">
          Agent giữ nguyên mô hình AI và khoá của nó. Gửi key trong header{" "}
          <code className="font-mono text-xs">Authorization: Bearer …</code>. Kiểm tra và ký verdict là dịch
          vụ trả phí qua x402: lần gọi đầu nhận 402 kèm PAYMENT-REQUIRED, ví agent trả USDC rồi gọi lại (thư
          viện @x402/fetch làm việc này).
        </p>
        <table className="w-full text-left text-xs">
          <tbody>
            {[
              ["GET", "/me", "Agent, policy đang hiệu lực, ngân sách hôm nay"],
              ["POST", "/check", "Guardian kiểm tra một batch {calls} (trả phí)"],
              ["POST", "/cosign", "Kiểm tra và ký verdict; chỉ khi policy đang hiệu lực (trả phí)"],
              ["GET", "/checks/:checkId", "Kết quả một lần kiểm tra"],
              ["GET", "/transactions/:hash", "Trạng thái thực thi đã xác minh trên chain"],
            ].map(([m, p, d]) => (
              <tr key={p} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 font-mono">{m}</td>
                <td className="py-1.5 pr-2 font-mono break-all">{p}</td>
                <td className="py-1.5 text-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
          {`curl -H "Authorization: Bearer $GUARDIAN_API_KEY" \\
  ${base}/me`}
        </pre>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
          {`// Node: @x402/fetch trả phí bằng ví agent (tối đa 0.02 USDC/lần)
const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:43113", client: new ExactEvmScheme(agentAccount) }],
});
const res = await pay("${base}/cosign", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: \`Bearer \${process.env.GUARDIAN_API_KEY}\`,
  },
  body: JSON.stringify({ calls, lang: "vi" }),
});`}
        </pre>
        <p className="text-xs text-muted">
          Vault mới là nơi cưỡng chế policy: agent gọi thẳng vault mà không qua API vẫn bị giới hạn y như vậy.
        </p>
      </div>
    </details>
  );
}

function AddAgent({ vault, prefill, onAdded }: { vault: string; prefill: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(prefill);
  const [description, setDescription] = useState("");
  const add = useMutation({
    mutationFn: () => wsApi(vault, "agents", "POST", { name, address: address.trim(), description }),
    onSuccess: () => {
      setName("");
      setAddress("");
      setDescription("");
      onAdded();
    },
  });
  return (
    <Card title="Đăng ký agent">
      <p className="text-sm text-muted">
        Chỉ lưu địa chỉ công khai của ví thực thi, không bao giờ lưu khoá. Ví chủ không được làm agent. Đăng
        ký chưa cấp quyền gì: agent chỉ thực thi được khi được gán policy và ví chủ ký áp dụng lên vault.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="agent-name" label="Tên agent">
            <input
              id="agent-name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field id="agent-address" label="Địa chỉ ví thực thi (0x…)">
            <input
              id="agent-address"
              required
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={`${INPUT} font-mono`}
            />
          </Field>
          <Field
            id="agent-description"
            label="Mô tả nhiệm vụ (không bắt buộc)"
            hint="Để bạn nhận ra agent, ví dụ: trả tiền nhà cung cấp hằng tuần. Guardian không chạy agent."
          >
            <input
              id="agent-description"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        <FormError error={add.error} />
        <Button variant="primary" type="submit" isDisabled={add.isPending} className="self-start">
          {add.isPending ? "Đang lưu…" : "Đăng ký agent"}
        </Button>
      </form>
    </Card>
  );
}
