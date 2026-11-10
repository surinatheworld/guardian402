"use client";
// Agents tab: the owner's registry of AI agents for this vault, with the live on-chain agent() marked.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { AddressLink, Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { ConfirmInline, Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import {
  AGENT_STATUS_LABEL,
  STRATEGY_LABEL,
  useAgents,
  useInvalidate,
  wsApi,
  type Agent,
} from "@/lib/workspace";

export function AgentsTab({ vault }: { vault: string }) {
  const q = useAgents(vault);
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
      <Card title="Agent trên chain">
        {onChainAgent ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Vault đang cho phép agent <AddressLink address={onChainAgent} /> gửi giao dịch (đọc trực tiếp từ
              hàm <code className="font-mono text-xs">agent()</code> của vault).
            </p>
            {unregistered ? (
              <Button
                variant="secondary"
                type="button"
                className="self-start"
                onPress={() => setPrefill(onChainAgent)}
              >
                Thêm agent này vào danh sách
              </Button>
            ) : null}
          </div>
        ) : (
          <Empty>Vault chưa có agent nào trên chain (agent đã bị thu hồi hoặc chưa đặt).</Empty>
        )}
      </Card>

      <Card title="Danh sách agent">
        {agents.length === 0 ? (
          <Empty>Chưa có agent nào trong danh sách.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {agents.map((a) => (
              <AgentItem key={a.id} vault={vault} agent={a} onChanged={() => invalidate("agents")} />
            ))}
          </ul>
        )}
      </Card>

      <AddAgent key={prefill} vault={vault} prefill={prefill} onAdded={() => invalidate("agents")} />
    </div>
  );
}

function AgentItem({ vault, agent, onChanged }: { vault: string; agent: Agent; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const update = useMutation({
    mutationFn: (status: Agent["status"]) => wsApi(vault, `agents/${agent.id}`, "PATCH", { status }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => wsApi(vault, `agents/${agent.id}`, "DELETE"),
    onSuccess: onChanged,
  });
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{agent.name}</span>
        {agent.isOnChainAgent ? (
          <Pill tone="ok">Đang là agent trên chain</Pill>
        ) : (
          <Pill>Không phải agent trên chain</Pill>
        )}
        <Pill tone={agent.status === "active" ? "neutral" : "warn"}>{AGENT_STATUS_LABEL[agent.status]}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <AddressLink address={agent.address} />
        <span className="text-muted">{STRATEGY_LABEL[agent.strategy]}</span>
      </div>
      {agent.description ? <p className="text-sm text-muted">{agent.description}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`agent-status-${agent.id}`} label="Trạng thái">
          <select
            id={`agent-status-${agent.id}`}
            value={agent.status}
            disabled={update.isPending}
            onChange={(e) => update.mutate(e.target.value as Agent["status"])}
            className={INPUT}
          >
            {Object.entries(AGENT_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {confirm ? (
          <ConfirmInline
            text="Xoá agent khỏi danh sách? (Không đổi gì trên chain.)"
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
            onCancel={() => setConfirm(false)}
          />
        ) : (
          <Button
            variant="secondary"
            type="button"
            onPress={() => {
              remove.reset();
              setConfirm(true);
            }}
          >
            Xoá
          </Button>
        )}
      </div>
      <FormError error={update.error ?? remove.error} />
    </li>
  );
}

function AddAgent({ vault, prefill, onAdded }: { vault: string; prefill: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(prefill);
  const [strategy, setStrategy] = useState<Agent["strategy"]>("dca");
  const [description, setDescription] = useState("");
  const add = useMutation({
    mutationFn: () =>
      wsApi(vault, "agents", "POST", { name, address: address.trim(), strategy, description }),
    onSuccess: () => {
      setName("");
      setAddress("");
      setDescription("");
      onAdded();
    },
  });
  return (
    <Card title="Thêm agent">
      <p className="text-sm text-muted">
        Chỉ lưu địa chỉ công khai của agent, không bao giờ lưu khoá. Ví chủ không được làm agent. Thêm vào
        danh sách không cấp quyền gì: muốn agent hoạt động, hãy soạn thay đổi “Đặt agent” ở tab Chính sách và
        ký bằng ví chủ.
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
          <Field id="agent-address" label="Địa chỉ agent (0x…)">
            <input
              id="agent-address"
              required
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={`${INPUT} font-mono`}
            />
          </Field>
          <Field id="agent-strategy" label="Chiến lược">
            <select
              id="agent-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Agent["strategy"])}
              className={INPUT}
            >
              {Object.entries(STRATEGY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field id="agent-description" label="Mô tả (không bắt buộc)">
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
          {add.isPending ? "Đang lưu…" : "Thêm agent"}
        </Button>
      </form>
    </Card>
  );
}
