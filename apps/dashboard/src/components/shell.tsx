"use client";
// The app frame: DEMO banner, sidebar (vault switcher + five destinations), top bar (protection status, the
// emergency lock, notifications, wallet, account) and the main column. One place for each of these.
import {
  Bell,
  CircleInfo,
  CirclePlay,
  Cpu,
  House,
  Lock,
  LockOpen,
  Person,
  Pulse,
  Shield,
} from "@gravity-ui/icons";
import { Avatar } from "@heroui/react/avatar";
import { Badge } from "@heroui/react/badge";
import { Button, buttonVariants } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { Popover } from "@heroui/react/popover";
import { Select } from "@heroui/react/select";
import { Skeleton } from "@heroui/react/skeleton";
import { Tabs } from "@heroui/react/tabs";
import { toast } from "@heroui/react/toast";
import { Tooltip } from "@heroui/react/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi } from "@guardian402/shared";
import { accountApi, ME_KEY, useMe } from "@/lib/account";
import { useAgentHealth, useGuardianHealth } from "@/lib/api";
import { deployment, NETWORK } from "@/lib/config";
import { formatTime, shortHex } from "@/lib/format";
import { PAGE } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";
import { useInvalidate, useNotifications, wsApi } from "@/lib/workspace";
import { useOwnerAction } from "./owner-action";
import { ErrorBox, Loading, Notice } from "./ui";
import { useOwnerGate, WalletMenu } from "./wallet";

export const NAV = [
  { href: "/", label: PAGE.home, icon: House },
  { href: "/hoat-dong", label: PAGE.activity, icon: Pulse },
  { href: "/chay-thu", label: PAGE.trial, icon: CirclePlay },
  { href: "/quy-tac", label: "Quy tắc", icon: Shield },
  { href: "/agent", label: PAGE.agents, icon: Cpu },
] as const;

const activeHref = (pathname: string) =>
  NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))?.href ?? "";

export function DemoBanner() {
  const guardian = useGuardianHealth();
  const agent = useAgentHealth();
  const demo = guardian.data?.demoMode === true || agent.isSuccess;
  if (!demo) return null;
  return (
    <div role="note" className="bg-warning-soft text-warning-soft-foreground">
      <p className="mx-auto max-w-7xl px-[max(16px,env(safe-area-inset-left,0px))] py-1.5 text-xs leading-5 sm:text-sm">
        <strong className="mr-1.5 font-semibold">DEMO MODE</strong>
        {NETWORK === "local" ? "Fork Avalanche Fuji" : "Mạng thử Avalanche Fuji"}, không có tiền thật. Oracle,
        pool, kịch bản tấn công và địa chỉ nhái (khớp 3+3 ký tự) là mô phỏng.
      </p>
    </div>
  );
}

function Brand() {
  return (
    <NextLink href="/" className="flex items-baseline gap-0.5 text-lg font-semibold tracking-tight">
      guardian<span className="text-accent">402</span>
    </NextLink>
  );
}

/** The one vault switcher. Signed out or with no linked vault, it shows the demo vault. */
function VaultSwitcher() {
  const { address, setVault } = useSelectedVault();
  const vaults = useMe().data?.vaults ?? [];
  if (vaults.length < 2) {
    const v = vaults[0];
    return (
      <div className="flex min-w-0 flex-col rounded-xl bg-surface-secondary px-3 py-2">
        <span className="truncate text-sm font-medium">{v?.label ?? (v ? "Két của tôi" : "Két demo")}</span>
        <span className="font-mono text-xs text-muted" title={address}>
          {shortHex(address)}
        </span>
      </div>
    );
  }
  return (
    <Select
      aria-label="Két đang xem"
      className="min-w-0"
      value={address}
      onChange={(key) => key !== null && setVault(String(key))}
    >
      <Select.Trigger>
        <Select.Value className="min-w-0 truncate" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {vaults.map((v) => (
            <ListBox.Item key={v.address} id={v.address} textValue={v.label ?? v.address}>
              <div className="flex min-w-0 flex-col">
                <Label>{v.label ?? "Két"}</Label>
                <span className="font-mono text-xs text-muted">{shortHex(v.address)}</span>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function NavTabs({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return (
    <Tabs
      orientation={orientation}
      align={orientation === "vertical" ? "start" : "center"}
      selectedKey={activeHref(pathname)}
      className={orientation === "vertical" ? "w-full" : "w-full"}
    >
      <Tabs.ListContainer className={orientation === "vertical" ? "w-full" : ""}>
        <Tabs.List aria-label="Trang" className={orientation === "vertical" ? "w-full" : ""}>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Tabs.Tab
              key={href}
              id={href}
              href={href}
              render={(props: object) => <NextLink {...(props as { href: string })} />}
              className="gap-2 whitespace-nowrap"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-5 border-r border-separator bg-surface px-3 py-5 lg:flex">
      <div className="px-2">
        <Brand />
      </div>
      <VaultSwitcher />
      <nav aria-label="Trang chính">
        <NavTabs orientation="vertical" />
      </nav>
      <div className="mt-auto flex flex-col gap-3 px-2">
        <NextLink
          href="/ve-guardian"
          aria-current={pathname === "/ve-guardian" ? "page" : undefined}
          className={buttonVariants({
            variant: pathname === "/ve-guardian" ? "secondary" : "ghost",
            size: "sm",
            className: "justify-start",
          })}
        >
          <CircleInfo aria-hidden="true" />
          {PAGE.about}
        </NextLink>
        <Chip size="sm" variant="secondary" className="self-start">
          {NETWORK === "fuji" ? "Mạng thử Fuji" : "Fork của Fuji"}
        </Chip>
      </div>
    </aside>
  );
}

/** "Đang bảo vệ" or "Két đang khoá", and the one emergency lock of the app. */
function ProtectionControl() {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const gate = useOwnerGate(p?.owner);
  const { writeContractAsync } = useWriteContract();
  const owner = useOwnerAction();
  if (policy.isPending) return <Skeleton className="h-7 w-28 rounded-full" />;
  if (!p) return null;
  const toggle = () =>
    owner.request(
      p.paused
        ? {
            title: "Mở khoá két",
            summary: "Agent được chi tiêu trở lại, vẫn trong hạn mức và danh sách tin cậy.",
            changes: [{ label: "Trạng thái", before: "Đã khoá", after: "Đang bảo vệ" }],
            call: "AgentVault.unpause()",
            confirmLabel: "Ký và mở khoá",
            successTitle: "Đã mở khoá két",
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "unpause",
                chainId: avalancheFuji.id,
              }),
          }
        : {
            title: "Khoá khẩn cấp",
            summary:
              "Agent không chi được gì cho tới khi bạn mở khoá. Tiền vẫn nằm trong két và bạn vẫn rút được.",
            changes: [{ label: "Trạng thái", before: "Đang bảo vệ", after: "Đã khoá" }],
            call: "AgentVault.pause()",
            confirmLabel: "Ký và khoá két",
            successTitle: "Đã khoá két",
            danger: true,
            send: () =>
              writeContractAsync({
                address: vault,
                abi: agentVaultAbi,
                functionName: "pause",
                chainId: avalancheFuji.id,
              }),
          },
    );
  const button = (
    <Button size="sm" variant={p.paused ? "secondary" : "danger-soft"} isDisabled={!gate.ok} onPress={toggle}>
      {p.paused ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span className="hidden sm:inline">{p.paused ? "Mở khoá" : "Khoá khẩn cấp"}</span>
    </Button>
  );
  return (
    <div className="flex items-center gap-2">
      <Chip size="sm" variant="soft" color={p.paused ? "danger" : "success"}>
        {p.paused ? "Két đang khoá" : "Đang bảo vệ"}
      </Chip>
      {gate.ok ? (
        button
      ) : (
        <Tooltip delay={200}>
          <Tooltip.Trigger>
            <span tabIndex={0} aria-label={`${p.paused ? "Mở khoá" : "Khoá khẩn cấp"}: ${gate.message}`}>
              {button}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content className="max-w-64 text-sm">{gate.message}</Tooltip.Content>
        </Tooltip>
      )}
      {owner.dialog}
    </div>
  );
}

function NotificationBell() {
  const { address: vault } = useSelectedVault();
  const me = useMe();
  const linked = me.data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? false;
  if (!linked) return null;
  return <LinkedBell vault={vault} />;
}

function LinkedBell({ vault }: { vault: string }) {
  const n = useNotifications(vault);
  const invalidate = useInvalidate(vault);
  const readAll = useMutation({
    mutationFn: () => wsApi(vault, "notifications/read", "POST", { all: true }),
    onSuccess: () => invalidate("notifications"),
  });
  const unread = n.data?.unread ?? 0;
  const latest = (n.data?.notifications ?? []).slice(0, 5);
  return (
    <Popover>
      <Popover.Trigger>
        <Badge.Anchor>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
          >
            <Bell aria-hidden="true" />
          </Button>
          {unread ? (
            <Badge color="danger" size="sm">
              {unread > 9 ? "9+" : unread}
            </Badge>
          ) : null}
        </Badge.Anchor>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-80 max-w-[calc(100vw-32px)]">
        <Popover.Dialog className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Popover.Heading className="text-sm font-semibold">Thông báo</Popover.Heading>
            {unread ? (
              <Button
                size="sm"
                variant="ghost"
                isPending={readAll.isPending}
                onPress={() => readAll.mutate()}
              >
                Đánh dấu đã đọc
              </Button>
            ) : null}
          </div>
          {n.isPending ? (
            <Loading />
          ) : latest.length === 0 ? (
            <p className="text-sm text-muted">Chưa có thông báo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {latest.map((x) => (
                <li key={x.id} className="flex flex-col gap-0.5 rounded-lg p-2 text-sm">
                  <span className={x.readAt ? "text-muted" : "font-medium"}>{x.title}</span>
                  <span className="text-xs text-muted tabular-nums">{formatTime(x.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <NextLink
            href="/hoat-dong#canh-bao"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Xem hoạt động và cài đặt cảnh báo
          </NextLink>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function AccountMenu() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => accountApi("/api/auth/logout", "POST"),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast("Đã đăng xuất");
      router.push("/");
    },
  });
  if (me.isPending) return <Skeleton className="size-8 rounded-full" />;
  if (!me.data)
    return (
      <NextLink href="/tai-khoan" className={buttonVariants({ variant: "secondary", size: "sm" })}>
        <Person aria-hidden="true" />
        Đăng nhập
      </NextLink>
    );
  const u = me.data.user;
  const name = u.displayName ?? u.email ?? shortHex(me.data.wallets[0]?.address ?? "");
  return (
    <Dropdown>
      <Button isIconOnly variant="ghost" size="sm" aria-label={`Tài khoản: ${name}`}>
        <Avatar size="sm">
          <Avatar.Fallback>{(name || "?").slice(0, 1).toUpperCase()}</Avatar.Fallback>
        </Avatar>
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-56">
        <Dropdown.Menu
          aria-label="Tài khoản"
          onAction={(key) => {
            if (key === "account") router.push("/tai-khoan");
            if (key === "about") router.push("/ve-guardian");
            if (key === "logout") logout.mutate();
          }}
        >
          <Dropdown.Item id="account" textValue="Tài khoản">
            <div className="flex min-w-0 flex-col">
              <Label>{name}</Label>
              <span className="text-xs text-muted">Tài khoản, ví và két đã liên kết</span>
            </div>
          </Dropdown.Item>
          <Dropdown.Item id="about" textValue={PAGE.about}>
            <Label>{PAGE.about}</Label>
          </Dropdown.Item>
          <Dropdown.Item id="logout" textValue="Đăng xuất" variant="danger">
            <Label>Đăng xuất</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function TopBar() {
  return (
    <div className="sticky top-0 z-30 border-b border-separator bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-[max(16px,env(safe-area-inset-left,0px))] py-2.5 lg:px-8">
        <div className="flex min-w-0 items-center lg:hidden">
          <Brand />
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ProtectionControl />
          <NotificationBell />
          <WalletMenu />
          <AccountMenu />
        </div>
      </div>
      <nav aria-label="Trang chính" className="px-2 pb-1 lg:hidden">
        <NavTabs orientation="horizontal" />
      </nav>
    </div>
  );
}

/** The main column. Switching vaults remounts the page so drafts and results of the other vault are dropped. */
export function VaultMain({ children }: { children: ReactNode }) {
  const { address, ready } = useSelectedVault();
  const me = useMe();
  const policy = useVaultPolicy();
  const pathname = usePathname();
  const accountFree = pathname === "/tai-khoan" || pathname === "/ve-guardian" || pathname === "/chay-thu";
  return (
    <main
      key={address}
      id="noi-dung"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[max(16px,env(safe-area-inset-left,0px))] py-6 lg:px-8 lg:py-8"
    >
      {/* Below the sidebar breakpoint the vault switcher opens the page instead of crowding the top bar. */}
      <div className="lg:hidden">
        <VaultSwitcher />
      </div>
      {policy.data?.paused && !accountFree ? (
        <Notice status="danger" title="Két đang khoá">
          Agent không chi được gì cho tới khi chủ két mở khoá. Tiền vẫn nằm trong két.
        </Notice>
      ) : null}
      {me.isPending || !ready ? (
        <Loading label="Đang tải…" />
      ) : me.isError && !accountFree ? (
        <ErrorBox
          title="Không đọc được tài khoản"
          detail="Không xác định được két đang chọn. Hãy thử lại."
          onRetry={() => void me.refetch()}
        />
      ) : (
        children
      )}
    </main>
  );
}

export const isDemoVault = (vault: string) => vault.toLowerCase() === deployment.vault.toLowerCase();
