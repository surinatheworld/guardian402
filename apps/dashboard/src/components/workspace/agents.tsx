"use client";
// The AI agents registered for a linked vault. Each one shows three separate things: its rule set (what it may
// do), its Guardian API keys (who may call the Guardian as it), and whether the vault lets it spend at all.
// The Guardian does not run the agent: its model, prompts and schedule stay outside.
import { Copy, CopyCheck, Ellipsis, Key, Plus, TrashBin } from "@gravity-ui/icons";
import { Button, buttonVariants } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Description } from "@heroui/react/description";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Modal } from "@heroui/react/modal";
import { Switch } from "@heroui/react/switch";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import NextLink from "next/link";
import { useState, useSyncExternalStore } from "react";
import { isAddress, type Address } from "viem";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { EditModal } from "@/components/edit-modal";
import { TextInput, useConfirm } from "@/components/fields";
import { errorOf } from "@/components/form";
import type { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Card, Empty, ErrorBox, Expand, LoadingRows } from "@/components/ui";
import type { OwnerGate } from "@/components/wallet";
import { formatTime } from "@/lib/format";
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

type Owner = ReturnType<typeof useOwnerAction>;

export function AgentsList({
  vault,
  gate,
  owner,
  adding,
  setAdding,
}: {
  vault: Address;
  gate: OwnerGate;
  owner: Owner;
  adding: boolean;
  setAdding: (open: boolean) => void;
}) {
  const q = useAgents(vault);
  const overview = useAssignments(vault);
  const invalidate = useInvalidate(vault);
  const [prefill, setPrefill] = useState("");
  if (q.isPending) return <LoadingRows rows={3} label="Đang tải agent" />;
  if (q.isError)
    return (
      <ErrorBox
        title="Không đọc được danh sách agent"
        detail={errorOf(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const { agents, onChainAgent } = q.data;
  const unregistered = onChainAgent && !agents.some((a) => a.isOnChainAgent) ? onChainAgent : null;
  return (
    <div className="flex flex-col gap-4">
      {unregistered ? (
        <Card
          title="Agent chưa có trong danh sách"
          description="Két đang cho địa chỉ này chi tiêu, nhưng bạn chưa đặt tên hay cấp khoá API cho nó."
          actions={
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                setPrefill(unregistered);
                setAdding(true);
              }}
            >
              Đăng ký agent này
            </Button>
          }
        >
          <AddressLink address={unregistered} />
        </Card>
      ) : null}
      {agents.length === 0 ? (
        <Card title="Chưa có agent nào">
          <Empty
            action={
              <Button size="sm" variant="primary" onPress={() => setAdding(true)}>
                <Plus aria-hidden="true" />
                Thêm agent
              </Button>
            }
          >
            Thêm AI agent bạn đang chạy ở nơi khác: đặt tên, nhập địa chỉ ví của nó, rồi cấp khoá API.
          </Empty>
        </Card>
      ) : (
        agents.map((a) => (
          <AgentCard
            key={a.id}
            vault={vault}
            agent={a}
            overview={overview.data?.agents.find((x) => x.agent.id === a.id)}
            gate={gate}
            owner={owner}
            onChanged={() => invalidate("agents", "assignments")}
          />
        ))
      )}
      <AddAgent
        key={prefill}
        vault={vault}
        prefill={prefill}
        isOpen={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setPrefill("");
        }}
        onAdded={() => invalidate("agents", "assignments")}
      />
    </div>
  );
}

function AgentCard({
  vault,
  agent,
  overview,
  gate,
  owner,
  onChanged,
}: {
  vault: Address;
  agent: Agent;
  overview: AssignmentOverview["agents"][number] | undefined;
  gate: OwnerGate;
  owner: Owner;
  onChanged: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const confirm = useConfirm();
  const update = useMutation({
    mutationFn: (status: Agent["status"]) => wsApi(vault, `agents/${agent.id}`, "PATCH", { status }),
    onSuccess: (_d, status) => {
      onChanged();
      toast(
        status === "active"
          ? `${agent.name} được gọi Guardian trở lại`
          : `Đã ${AGENT_STATUS_LABEL[status].toLowerCase()}`,
      );
    },
    onError: (e) => toast.danger("Chưa đổi được trạng thái", { description: errorOf(e) }),
  });
  const a = overview?.assignment;
  const e = overview?.enforcement;

  const setAsAgent = () =>
    owner.request({
      title: `Cho ${agent.name} chi tiêu từ két`,
      summary: (
        <>
          Két chỉ có một agent. <AddressLink address={agent.address} name={agent.name} /> sẽ thay agent hiện
          tại và chi tiêu theo quy tắc của két.
        </>
      ),
      call: `AgentVault.setAgent(${agent.address})`,
      confirmLabel: "Ký và đặt agent",
      successTitle: `${agent.name} là agent của két`,
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAgent",
          args: [agent.address],
          chainId: avalancheFuji.id,
        }),
    });

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {agent.name}
          {agent.isOnChainAgent ? (
            <Chip size="sm" variant="soft" color="success">
              Đang chi tiêu từ két
            </Chip>
          ) : null}
          {agent.status !== "active" ? (
            <Chip size="sm" variant="soft" color="warning">
              {AGENT_STATUS_LABEL[agent.status]}
            </Chip>
          ) : null}
        </span>
      }
      description={agent.description ?? undefined}
      actions={
        <Dropdown>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`Thao tác khác với ${agent.name}`}>
            <Ellipsis aria-hidden="true" />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              aria-label={`Thao tác với ${agent.name}`}
              disabledKeys={[
                ...(agent.isOnChainAgent ? ["delete"] : []),
                ...(agent.status === "retired" ? ["retire"] : []),
              ]}
              onAction={(key) => {
                if (key === "retire")
                  confirm.ask({
                    title: `Ngừng dùng ${agent.name}?`,
                    body: "Khoá API của agent này không gọi được Guardian nữa. Két không đổi gì.",
                    confirmLabel: "Ngừng dùng",
                    onConfirm: () => update.mutateAsync("retired"),
                  });
                if (key === "delete")
                  confirm.ask({
                    title: `Xoá ${agent.name} khỏi danh sách?`,
                    body: "Bộ quy tắc đang gán và khoá API của nó cũng bị xoá. Két không đổi gì.",
                    confirmLabel: "Xoá agent",
                    onConfirm: async () => {
                      await wsApi(vault, `agents/${agent.id}`, "DELETE");
                      onChanged();
                      toast(`Đã xoá ${agent.name}`);
                    },
                  });
              }}
            >
              <Dropdown.Item id="retire" textValue="Ngừng dùng">
                <Label>Ngừng dùng</Label>
              </Dropdown.Item>
              <Dropdown.Item id="delete" textValue="Xoá khỏi danh sách" variant="danger">
                <Label>Xoá khỏi danh sách</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      }
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Ví của agent</span>
          <AddressLink address={agent.address} />
          {!agent.isOnChainAgent ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-1 self-start"
              isDisabled={!gate.ok}
              onPress={setAsAgent}
            >
              Cho chi tiêu từ két
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Bộ quy tắc</span>
          {a ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              {a.policy.name} · phiên bản {a.version.version}
              {e?.state === "active" ? (
                <Chip size="sm" variant="soft" color="success">
                  Đang áp dụng
                </Chip>
              ) : e?.state === "pending" ? (
                <Chip size="sm" variant="soft" color="warning">
                  Chờ ký {e.plan.changes.length} thay đổi
                </Chip>
              ) : null}
            </span>
          ) : (
            <span className="text-sm text-muted">
              Chưa gán: Guardian không duyệt giao dịch cho agent này.
            </span>
          )}
          <NextLink
            href={`/quy-tac?agent=${agent.id}#bo-quy-tac`}
            className={buttonVariants({ variant: "secondary", size: "sm", className: "mt-1 self-start" })}
          >
            {a ? "Đổi bộ quy tắc" : "Gán bộ quy tắc"}
          </NextLink>
        </div>
      </div>

      <div className="border-t border-separator pt-4">
        <Switch
          isSelected={agent.status === "active"}
          isDisabled={agent.status === "retired" || update.isPending}
          onChange={(on) => update.mutate(on ? "active" : "paused")}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label>Cho phép gọi Guardian</Label>
            <Description>
              Tắt để tạm ngưng mọi khoá API của agent này. Muốn chặn chi tiêu ngay trên két, dùng Gỡ quyền
              agent.
            </Description>
          </Switch.Content>
        </Switch>
      </div>

      <AgentKeys vault={vault} agent={agent} />
      {confirm.dialog}
    </Card>
  );
}

// ------------------------------------------------------------------ API keys and integration

function AgentKeys({ vault, agent }: { vault: Address; agent: Agent }) {
  const q = useAgentKeys(vault, agent.id);
  const invalidate = useInvalidate(vault);
  const confirm = useConfirm();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      wsApi<{ key: string; apiKey: ApiKey }>(vault, `agents/${agent.id}/keys`, "POST", { name }),
    onSuccess: (r) => {
      setNaming(false);
      setName("");
      setCopied(false);
      setFresh(r.key);
      void invalidate("keys");
    },
  });
  const active = (q.data?.keys ?? []).filter((k) => k.revokedAt === null);
  const revoked = (q.data?.keys ?? []).filter((k) => k.revokedAt !== null).length;
  return (
    <section
      aria-label={`Khoá API của ${agent.name}`}
      className="flex flex-col gap-3 border-t border-separator pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Khoá API</h3>
        {agent.status !== "retired" ? (
          <Button size="sm" variant="secondary" onPress={() => setNaming(true)}>
            <Key aria-hidden="true" />
            Tạo khoá API
          </Button>
        ) : null}
      </div>
      {q.isPending ? (
        <LoadingRows rows={1} />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorOf(q.error)}
        </p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted">Chưa có khoá nào. Agent cần khoá API để gọi Guardian.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-separator">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {k.name} <code className="font-mono text-xs text-muted">{k.prefix}…</code>
                </span>
                <span className="text-xs text-muted tabular-nums">
                  Tạo {formatTime(k.createdAt)} ·{" "}
                  {k.lastUsedAt ? `dùng lần cuối ${formatTime(k.lastUsedAt)}` : "chưa dùng"}
                </span>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={`Thu hồi khoá ${k.name}`}
                onPress={() =>
                  confirm.ask({
                    title: `Thu hồi khoá “${k.name}”?`,
                    body: "Agent dùng khoá này sẽ không gọi được Guardian nữa.",
                    confirmLabel: "Thu hồi khoá",
                    onConfirm: async () => {
                      await wsApi(vault, `agents/${agent.id}/keys/${k.id}`, "DELETE");
                      await invalidate("keys");
                      toast(`Đã thu hồi khoá “${k.name}”`);
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
      {revoked ? <p className="text-xs text-muted">{revoked} khoá đã thu hồi.</p> : null}
      <Expand label="Hướng dẫn tích hợp">
        <Integration />
      </Expand>

      <EditModal
        isOpen={naming}
        onOpenChange={(o) => {
          create.reset();
          setNaming(o);
        }}
        title="Tạo khoá API"
        submitLabel={create.isPending ? "Đang tạo…" : "Tạo khoá"}
        isSubmitDisabled={create.isPending}
        onSubmit={() => create.mutate()}
      >
        <TextInput
          label="Tên khoá (không bắt buộc)"
          value={name}
          onChange={setName}
          maxLength={60}
          placeholder="Ví dụ: máy chủ chính"
          description="Khoá chỉ dùng để gọi Guardian; nó không đổi được quy tắc và không phải khoá ví."
          autoFocus
        />
        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorOf(create.error)}
          </p>
        ) : null}
      </EditModal>

      <Modal.Backdrop
        isOpen={fresh !== null}
        isDismissable={false}
        onOpenChange={(o) => !o && setFresh(null)}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.Header>
              <Modal.Heading className="text-lg font-semibold">Lưu khoá API ngay</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              <p className="text-sm">
                Khoá chỉ hiện một lần. Lưu vào biến môi trường của agent, ví dụ{" "}
                <code className="font-mono">GUARDIAN_API_KEY</code>.
              </p>
              <code className="rounded-xl bg-surface-secondary p-3 font-mono text-xs break-all">{fresh}</code>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="secondary"
                onPress={() => {
                  if (!fresh) return;
                  navigator.clipboard
                    .writeText(fresh)
                    .then(() => {
                      setCopied(true);
                      toast.success("Đã sao chép khoá");
                    })
                    .catch(() =>
                      toast.danger("Không sao chép được", { description: "Hãy chọn và chép thủ công." }),
                    );
                }}
              >
                {copied ? <CopyCheck aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? "Đã sao chép" : "Sao chép"}
              </Button>
              <Button variant="primary" onPress={() => setFresh(null)}>
                Tôi đã lưu khoá
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {confirm.dialog}
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
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        Agent giữ nguyên mô hình AI và khoá ví của nó, gửi khoá API trong header{" "}
        <code className="font-mono text-xs">Authorization: Bearer …</code>. Kiểm tra và duyệt là dịch vụ trả
        phí qua x402: lần gọi đầu nhận 402, ví agent trả USDC rồi gọi lại (thư viện @x402/fetch tự làm việc
        này).
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {[
          ["GET /me", "Agent, bộ quy tắc đang áp dụng, hạn mức hôm nay"],
          ["POST /check", "Guardian kiểm tra một giao dịch (trả phí)"],
          ["POST /cosign", "Kiểm tra và ký duyệt khi bộ quy tắc đang áp dụng (trả phí)"],
          ["GET /checks/:checkId", "Kết quả một lần kiểm tra"],
          ["GET /transactions/:hash", "Trạng thái thực thi đã xác minh trên chain"],
        ].map(([path, text]) => (
          <div key={path} className="contents">
            <dt className="font-mono">{path}</dt>
            <dd className="text-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <pre className="overflow-x-auto rounded-xl bg-surface-secondary p-3 font-mono text-xs">
        {`curl -H "Authorization: Bearer $GUARDIAN_API_KEY" \\
  ${base}/me`}
      </pre>
      <p className="text-xs text-muted">
        Két mới là nơi cưỡng chế quy tắc: agent gọi thẳng két mà không qua API vẫn bị giới hạn y như vậy.
      </p>
    </div>
  );
}

function AddAgent({
  vault,
  prefill,
  isOpen,
  onOpenChange,
  onAdded,
}: {
  vault: Address;
  prefill: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(prefill);
  const [description, setDescription] = useState("");
  const add = useMutation({
    mutationFn: () => wsApi(vault, "agents", "POST", { name, address: address.trim(), description }),
    onSuccess: () => {
      onAdded();
      onOpenChange(false);
      toast.success(`Đã thêm ${name}`, { description: "Tiếp theo: gán bộ quy tắc và tạo khoá API." });
      setName("");
      setAddress("");
      setDescription("");
    },
  });
  const badAddress = address.trim() !== "" && !isAddress(address.trim());
  return (
    <EditModal
      isOpen={isOpen}
      onOpenChange={(o) => {
        add.reset();
        onOpenChange(o);
      }}
      title="Thêm agent"
      submitLabel={add.isPending ? "Đang lưu…" : "Thêm agent"}
      isSubmitDisabled={add.isPending || !name.trim() || !isAddress(address.trim())}
      onSubmit={() => add.mutate()}
    >
      <TextInput label="Tên agent" value={name} onChange={setName} isRequired maxLength={60} autoFocus />
      <TextInput
        label="Địa chỉ ví của agent"
        value={address}
        onChange={setAddress}
        isRequired
        mono
        placeholder="0x…"
        error={
          badAddress ? "Địa chỉ phải có dạng 0x và 40 ký tự hex." : add.error ? errorOf(add.error) : null
        }
        description="Chỉ lưu địa chỉ công khai, không bao giờ lưu khoá. Ví chủ két không được làm agent."
      />
      <TextInput
        label="Nhiệm vụ (không bắt buộc)"
        value={description}
        onChange={setDescription}
        maxLength={300}
        placeholder="Ví dụ: trả tiền nhà cung cấp hằng tuần"
      />
    </EditModal>
  );
}
