"use client";
// Agent: the one agent that spends from this vault (one agent per vault, SPEC §4.10), its fee wallet, and how to
// connect it — API key, MCP config, and a first prompt to try. Changing or removing the agent is an owner
// transaction; an API key only reaches the Guardian, never the money.
import { ArrowRight, Copy, Key, Persons, Thunderbolt, TrashBin } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Modal } from "@heroui/react/modal";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { McpSetup } from "@/components/connect-agent";
import { WebAgentTry } from "@/components/web-agent-try";
import { EditModal } from "@/components/edit-modal";
import { TextInput, useConfirm } from "@/components/fields";
import { errorOf } from "@/components/form";
import { AgentFeeForm } from "@/components/fund";
import { useOwnerAction } from "@/components/owner-action";
import { AddressLink, Empty, ErrorBox, LoadingRows, Notice } from "@/components/ui";
import { OwnerGateNotice, useOwnerGate } from "@/components/wallet";
import { AGENT_FEE_AVAX, AGENT_FEE_USDC, useBalances } from "@/lib/balances";
import { formatAmount, formatTime, shortHex, ZERO_ADDRESS } from "@/lib/format";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import {
  useAgentKeys,
  useAgents,
  useContacts,
  useInvalidate,
  wsApi,
  type Agent,
  type ApiKey,
} from "@/lib/workspace";
import { useMe } from "@/lib/account";

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="sm:p-5">
      <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-heading font-semibold">{title}</Card.Title>
          {description ? <Card.Description>{description}</Card.Description> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">{children}</Card.Content>
    </Card>
  );
}

export default function AgentPage() {
  const { address: vault, viewingDemo } = useSelectedVault();
  const me = useMe();
  const policy = useVaultPolicy();
  const p = policy.data;
  const linked =
    !viewingDemo && (me.data?.vaults ?? []).some((v) => v.address.toLowerCase() === vault.toLowerCase());
  const onChain = p && p.agent !== ZERO_ADDRESS ? p.agent : undefined;
  const agents = useAgents(linked ? vault : "");
  const registered = agents.data?.agents.find((a) => a.isOnChainAgent);
  const gate = useOwnerGate(p?.owner);

  return (
    <>
      <header className="flex flex-col gap-1 pt-4">
        <h1 className="text-title">Agent</h1>
      </header>
      {linked ? <OwnerGateNotice gate={gate} /> : null}
      {policy.isError ? (
        <ErrorBox title="Không đọc được két trên chain" onRetry={() => void policy.refetch()} />
      ) : !p ? (
        <LoadingRows rows={3} label="Đang đọc két" />
      ) : (
        <>
          <Identity vault={vault} agent={onChain} registered={registered} linked={linked} gateOk={gate.ok} />
          {onChain && linked ? (
            agents.isPending ? (
              <LoadingRows rows={2} />
            ) : registered ? (
              <>
                <Section
                  title="Thử agent ngay trên web"
                  description="Bấm một nút: trang này làm đúng việc agent của bạn sẽ làm, két kiểm tra quy tắc, xin Guardian duyệt khi cần, rồi két chi. Không cần cài gì."
                >
                  <WebAgentTry vault={vault} />
                </Section>
                <Connect vault={vault} agent={registered} />
              </>
            ) : (
              <NameAgent vault={vault} address={onChain} />
            )
          ) : null}
          {viewingDemo ? (
            <Notice title="Két demo chỉ xem">
              Khoá API và cấu hình MCP chỉ có ở két của bạn. Đăng nhập rồi tạo két để thử với agent của bạn.
            </Notice>
          ) : null}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ identity

function Identity({
  vault,
  agent,
  registered,
  linked,
  gateOk,
}: {
  vault: Address;
  agent: Address | undefined;
  registered: Agent | undefined;
  linked: boolean;
  gateOk: boolean;
}) {
  const b = useBalances(agent);
  const owner = useOwnerAction();
  const { writeContractAsync } = useWriteContract();
  const invalidate = useInvalidate(vault);
  const [fees, setFees] = useState(false);
  const [changing, setChanging] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const validNew = isAddress(address.trim()) && address.trim().toLowerCase() !== agent?.toLowerCase();

  const setAgent = (next: Address, label: string) =>
    owner.request({
      title: agent ? "Đổi ví agent" : "Đặt agent cho két",
      summary: agent
        ? "Ví agent cũ mất quyền chi ngay khi giao dịch xác nhận; ví mới chi được trong đúng các quy tắc hiện có."
        : "Ví này được chi tiêu từ két, trong đúng các quy tắc hiện có.",
      changes: [{ label: "Agent", before: agent ? shortHex(agent) : "Không có", after: shortHex(next) }],
      call: `AgentVault.setAgent(${next})`,
      confirmLabel: "Ký và đặt agent",
      successTitle: "Đã đổi agent",
      send: async () => {
        const hash = await writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAgent",
          args: [next],
          chainId: avalancheFuji.id,
        });
        // Name it in the registry so keys can be issued; a duplicate is fine.
        await wsApi(vault, "agents", "POST", { name: label || "Agent", address: next }).catch(
          () => undefined,
        );
        void invalidate("agents");
        return hash;
      },
    });

  const revoke = () =>
    agent &&
    owner.request({
      title: "Gỡ quyền agent",
      summary: (
        <>
          <AddressLink address={agent} /> không chi được gì từ két nữa, kể cả khi không qua Guardian. Tiền vẫn
          trong két.
        </>
      ),
      changes: [{ label: "Agent", before: shortHex(agent), after: "Không có" }],
      call: `AgentVault.setAgent(${ZERO_ADDRESS})`,
      confirmLabel: "Ký và gỡ quyền",
      successTitle: "Đã gỡ quyền agent",
      danger: true,
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAgent",
          args: [ZERO_ADDRESS],
          chainId: avalancheFuji.id,
        }),
    });

  const lowGas = b.avax !== undefined && b.avax < AGENT_FEE_AVAX / 5n;
  const lowFee = b.usdc !== undefined && b.usdc < AGENT_FEE_USDC / 5n;

  return (
    <Section
      title={agent ? (registered?.name ?? "Agent của két") : "Chưa có agent"}
      description={
        agent ? (
          <span className="flex flex-wrap items-center gap-2">
            <AddressLink address={agent} name="" />
            <Chip size="sm" color="success" variant="soft">
              <Chip.Label>Đang có quyền chi</Chip.Label>
            </Chip>
          </span>
        ) : (
          "Két chưa cho ví nào chi tiêu. Đặt ví của agent để bắt đầu."
        )
      }
      actions={
        linked ? (
          <>
            {agent ? (
              <Button variant="tertiary" size="sm" onPress={() => setFees(true)}>
                <Thunderbolt aria-hidden="true" />
                Gửi phí
              </Button>
            ) : null}
            <Button
              variant={agent ? "tertiary" : "primary"}
              size="sm"
              isDisabled={!gateOk}
              onPress={() => {
                setName(registered?.name ?? "");
                setAddress("");
                setChanging(true);
              }}
            >
              <Persons aria-hidden="true" />
              {agent ? "Đổi ví agent" : "Đặt agent"}
            </Button>
            {agent ? (
              <Button variant="danger-soft" size="sm" isDisabled={!gateOk} onPress={revoke}>
                Gỡ quyền
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {agent ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-4">
            <dt className="text-muted">Phí mạng trong ví agent</dt>
            <dd className={`text-heading tabular-nums ${lowGas ? "text-danger" : ""}`}>
              {b.avax === undefined ? "…" : `${formatAmount(b.avax, 18, 4)} AVAX`}
            </dd>
            <dd className="text-xs text-muted">Mỗi giao dịch của agent tốn khoảng 0,001 AVAX.</dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-4">
            <dt className="text-muted">Phí Guardian trong ví agent</dt>
            <dd className={`text-heading tabular-nums ${lowFee ? "text-danger" : ""}`}>
              {b.usdc === undefined ? "…" : `${formatAmount(b.usdc, 6, 2)} USDC`}
            </dd>
            <dd className="text-xs text-muted">Mỗi lần Guardian duyệt một khoản chi: 0,01 USDC.</dd>
          </div>
        </dl>
      ) : null}

      <EditModal
        isOpen={changing}
        onOpenChange={setChanging}
        title={agent ? "Đổi ví agent" : "Đặt agent cho két"}
        isSubmitDisabled={!validNew}
        onSubmit={() => {
          setChanging(false);
          setAgent(getAddress(address.trim()), name.trim());
        }}
      >
        <TextInput label="Tên agent" value={name} onChange={setName} maxLength={60} />
        <TextInput
          label="Địa chỉ ví mới của agent"
          value={address}
          onChange={setAddress}
          placeholder="0x…"
          description="Không dùng ví chủ: agent cần ví riêng."
          autoFocus
        />
      </EditModal>
      {agent ? (
        <Modal.Backdrop isOpen={fees} onOpenChange={setFees}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-lg">
              <Modal.CloseTrigger />
              <Modal.Header className="flex flex-col gap-1">
                <Modal.Heading className="text-heading">Gửi phí cho agent</Modal.Heading>
                <p className="text-sm text-muted">Từ ví của bạn sang ví agent. Không lấy từ két.</p>
              </Modal.Header>
              <Modal.Body className="pb-4">
                <AgentFeeForm agent={agent} />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}
      {owner.dialog}
    </Section>
  );
}

/** The vault has an agent on chain that the account has not named yet (e.g. set from another tool). */
function NameAgent({ vault, address }: { vault: Address; address: Address }) {
  const invalidate = useInvalidate(vault);
  const [name, setName] = useState("Agent của tôi");
  const save = useMutation({
    mutationFn: () => wsApi(vault, "agents", "POST", { name, address }),
    onSuccess: () => invalidate("agents"),
  });
  return (
    <Section title="Đặt tên cho agent" description="Cần tên để cấp khoá API cho agent này.">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <TextInput label="Tên agent" value={name} onChange={setName} maxLength={60} />
        </div>
        <Button
          variant="primary"
          isPending={save.isPending}
          isDisabled={!name.trim()}
          onPress={() => save.mutate()}
        >
          Lưu
        </Button>
      </div>
      {save.isError ? <p className="text-sm text-danger">{errorOf(save.error)}</p> : null}
    </Section>
  );
}

// ------------------------------------------------------------------ connect

function Connect({ vault, agent }: { vault: Address; agent: Agent }) {
  const q = useAgentKeys(vault, agent.id);
  const invalidate = useInvalidate(vault);
  const confirm = useConfirm();
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      wsApi<{ key: string; apiKey: ApiKey }>(vault, `agents/${agent.id}/keys`, "POST", { name: "Khoá API" }),
    onSuccess: (r) => {
      setFresh(r.key);
      void invalidate("keys");
    },
  });
  const active = (q.data?.keys ?? []).filter((k) => k.revokedAt === null);
  const lastUsed = Math.max(0, ...active.map((k) => k.lastUsedAt ?? 0));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Section
        title="Kết nối agent"
        description="Khoá API cho agent gọi Guardian. Nó không rút được tiền và không đổi được quy tắc."
        actions={
          <Button
            variant={active.length ? "tertiary" : "primary"}
            size="sm"
            isPending={create.isPending}
            onPress={() => create.mutate()}
          >
            <Key aria-hidden="true" />
            Tạo khoá mới
          </Button>
        }
      >
        {create.isError ? <p className="text-sm text-danger">{errorOf(create.error)}</p> : null}
        {q.isPending ? (
          <LoadingRows rows={1} />
        ) : active.length === 0 && !fresh ? (
          <Empty>Chưa có khoá nào. Tạo một khoá để agent kết nối được.</Empty>
        ) : (
          <ul aria-label="Khoá đang dùng" className="flex flex-col divide-y divide-separator">
            {active.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {k.name} <code className="font-mono text-xs text-muted">{k.prefix}…</code>
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    Tạo {formatTime(k.createdAt)} ·{" "}
                    {k.lastUsedAt
                      ? `agent gọi lần cuối ${formatTime(k.lastUsedAt)}`
                      : "agent chưa gọi lần nào"}
                  </span>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Thu hồi khoá ${k.prefix}`}
                  onPress={() =>
                    confirm.ask({
                      title: "Thu hồi khoá này?",
                      body: "Agent đang dùng khoá này sẽ không gọi được Guardian nữa. Tiền và quy tắc không đổi.",
                      confirmLabel: "Thu hồi",
                      onConfirm: async () => {
                        await wsApi(vault, `agents/${agent.id}/keys/${k.id}`, "DELETE");
                        await invalidate("keys");
                        toast("Đã thu hồi khoá");
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
        <div className="border-t border-separator pt-4">
          <McpSetup apiKey={fresh} newKeyHint='bấm "Tạo khoá mới"' />
        </div>
        {confirm.dialog}
      </Section>
      <TryIt vault={vault} connected={lastUsed > 0} lastUsed={lastUsed} />
    </div>
  );
}

/** What to ask the agent first, so the owner sees the rules work (suggested prompts, as in HeroUI's agent demos). */
function TryIt({ vault, connected, lastUsed }: { vault: Address; connected: boolean; lastUsed: number }) {
  const contacts = useContacts(vault);
  const first = contacts.data?.contacts.find((c) => c.allowlisted.recipient);
  const who = first?.name ?? "người nhận đầu tiên";
  const prompts = [
    "Đọc quy tắc chi tiêu của bạn và tóm tắt cho tôi.",
    `Trả 1 USDC cho ${who}.`,
    `Thử trả 50 USDC cho ${who}.`,
  ];
  return (
    <Card className="self-start sm:p-5">
      <Card.Header className="flex flex-col gap-1">
        <Card.Title className="text-heading font-semibold">Thử với agent</Card.Title>
        <Card.Description>
          {connected
            ? `Agent đã kết nối, gọi lần cuối ${formatTime(lastUsed)}.`
            : "Cấu hình xong thì gửi agent một câu dưới đây."}
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        {prompts.map((t, i) => (
          <Button
            key={t}
            variant="tertiary"
            className="h-auto justify-between gap-3 py-2.5 text-left whitespace-normal"
            onPress={async () => {
              await navigator.clipboard.writeText(t).catch(() => undefined);
              toast.success("Đã chép câu lệnh");
            }}
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="text-sm font-medium">“{t}”</span>
              <span className="text-xs font-normal text-muted">
                {i === 0
                  ? "Agent gọi get_rules, miễn phí."
                  : i === 1
                    ? "Guardian duyệt, két chi. Xem ở Hoạt động."
                    : "Vượt hạn mức: két từ chối, không mất phí Guardian lẫn phí mạng."}
              </span>
            </span>
            <Copy aria-hidden="true" className="size-4 shrink-0 text-muted" />
          </Button>
        ))}
      </Card.Content>
      <Card.Footer>
        <a href="/hoat-dong" className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          Xem kết quả ở Hoạt động
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </Card.Footer>
    </Card>
  );
}
