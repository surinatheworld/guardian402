"use client";
// Quản lý vault: the off-chain workspace around a linked AgentVault (docs/API.md): connected agents and their
// API keys, named policies assigned to agents, address book, owner changes signed in the wallet, alerts, and
// reviews of Guardian checks. The chain stays the authority.
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AddressLink, Card, Empty, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { errorOf } from "@/components/form";
import { AgentsTab } from "@/components/workspace/agents";
import { AlertsTab } from "@/components/workspace/alerts";
import { ChecksTab } from "@/components/workspace/checks";
import { ContactsTab } from "@/components/workspace/contacts";
import { PoliciesTab } from "@/components/workspace/policies";
import { PolicyTab } from "@/components/workspace/policy";
import { useMe } from "@/lib/account";
import { useNotifications } from "@/lib/workspace";

const TABS = [
  { id: "agent", label: "Agent" },
  { id: "policy", label: "Policy" },
  { id: "danh-ba", label: "Danh bạ" },
  { id: "chinh-sach", label: "Thay đổi on-chain" },
  { id: "canh-bao", label: "Cảnh báo" },
  { id: "kiem-tra", label: "Kiểm tra" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function ManagePage() {
  const me = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const vaults = me.data?.vaults ?? [];
  const vault = vaults.find((v) => v.address === selected) ?? vaults[0];
  const pageHeader = (
    <PageHeader
      title="Quản lý vault"
      lead="Kết nối AI agent, tạo policy và gán cho agent, cấp API key, theo dõi cảnh báo và các lần kiểm tra. Mọi thay đổi quyền trên vault đều do ví chủ ký; ngân sách, quyền và agent luôn đọc từ chain."
    />
  );

  return (
    <>
      {me.isPending || me.isError || !me.data || !vault ? pageHeader : null}
      {me.isPending ? (
        <Loading />
      ) : me.isError ? (
        <ErrorBox
          title="Không đọc được tài khoản"
          detail={errorOf(me.error)}
          onRetry={() => void me.refetch()}
        />
      ) : !me.data ? (
        <Card>
          <Empty>
            Bạn chưa đăng nhập.{" "}
            <Link href="/tai-khoan" className="font-semibold text-accent underline underline-offset-2">
              Đăng nhập ở trang Tài khoản
            </Link>
            .
          </Empty>
        </Card>
      ) : !vault ? (
        <Card>
          <Empty>
            Tài khoản chưa liên kết vault nào.{" "}
            <Link href="/tai-khoan" className="font-semibold text-accent underline underline-offset-2">
              Liên kết AgentVault ở trang Tài khoản
            </Link>{" "}
            (cần đăng nhập bằng ví chủ của vault).
          </Empty>
        </Card>
      ) : (
        <Workspace
          key={vault.address}
          vault={vault.address}
          vaultLabel={vault.label ?? "AgentVault"}
          ownerWallet={vault.ownerWallet}
          overview={
            <>
              {pageHeader}
              <Card>
                <div className="flex flex-wrap items-center gap-3">
                  {vaults.length > 1 ? (
                    <label className="flex items-center gap-2 text-sm font-medium">
                      Vault
                      <select
                        value={vault.address}
                        onChange={(e) => setSelected(e.target.value)}
                        className="min-h-[42px] rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                      >
                        {vaults.map((v) => (
                          <option key={v.address} value={v.address}>
                            {v.label ?? "AgentVault"} · {v.address.slice(0, 8)}…
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="font-semibold">{vault.label ?? "AgentVault"}</span>
                  )}
                  <AddressLink address={vault.address} />
                  <span className="text-sm text-muted">
                    Ví chủ: <span className="font-mono text-xs">{vault.ownerWallet}</span>
                  </span>
                </div>
              </Card>
            </>
          }
        />
      )}
    </>
  );
}

function Workspace({
  vault,
  vaultLabel,
  ownerWallet,
  overview,
}: {
  vault: `0x${string}`;
  vaultLabel: string;
  ownerWallet: `0x${string}`;
  overview: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("agent");
  const [editingPolicy, setEditingPolicy] = useState(false);
  const focused = tab === "policy" && editingPolicy;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const unread = useNotifications(vault).data?.unread ?? 0;

  // Deep link: /quan-ly#chinh-sach opens that tab (a bare token, see the hash rules of the viewer).
  useEffect(() => {
    const sync = () => {
      const fromHash = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === fromHash)) {
        setTab(fromHash as TabId);
        if (fromHash !== "policy") setEditingPolicy(false);
      }
    };
    sync();
    // Also when only the hash changes (a link to another tab while the page is open, back/forward).
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const open = (id: TabId) => {
    setTab(id);
    if (id !== "policy") setEditingPolicy(false);
    window.history.replaceState(null, "", `#${id}`);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    if (!t) return;
    open(t.id);
    refs.current[t.id]?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      {focused ? null : overview}
      {focused ? null : (
        <div role="tablist" aria-label="Phần quản lý" onKeyDown={onKey} className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[t.id] = el;
                }}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => open(t.id)}
                className={`min-h-[42px] rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active ? "bg-accent text-accent-fg" : "bg-surface text-muted hover:text-fg"
                }`}
              >
                {t.label}
                {t.id === "canh-bao" && unread > 0 ? (
                  <span className="ml-2 rounded-full bg-high px-2 py-0.5 text-xs text-surface">
                    {unread}
                    <span className="sr-only"> thông báo chưa đọc</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <div
        role={focused ? undefined : "tabpanel"}
        id={`panel-${tab}`}
        aria-labelledby={focused ? undefined : `tab-${tab}`}
      >
        {tab === "agent" ? (
          <AgentsTab
            vault={vault}
            onOpenPolicy={() => open("policy")}
            onOpenChanges={() => open("chinh-sach")}
          />
        ) : tab === "policy" ? (
          <PoliciesTab
            vault={vault}
            vaultLabel={vaultLabel}
            ownerWallet={ownerWallet}
            onBuilderChange={setEditingPolicy}
            onOpenAgents={() => open("agent")}
            onOpenChecks={() => open("kiem-tra")}
          />
        ) : tab === "danh-ba" ? (
          <ContactsTab vault={vault} onDraftCreated={() => open("chinh-sach")} />
        ) : tab === "chinh-sach" ? (
          <PolicyTab vault={vault} ownerWallet={ownerWallet} />
        ) : tab === "canh-bao" ? (
          <AlertsTab vault={vault} />
        ) : (
          <ChecksTab vault={vault} />
        )}
      </div>
    </div>
  );
}
