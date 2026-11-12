"use client";
// The app frame: sidebar (vault switcher + five destinations; a bottom bar on a phone), DEMO strip, top bar
// (protection status, the emergency lock, notifications, wallet, account), the paused strip and the main column.
import {
  Bell,
  CircleInfo,
  Cpu,
  House,
  Lock,
  LockOpen,
  Person,
  Play,
  Pulse,
  ShieldCheck,
  Sliders,
  Vault,
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
import { ThemeToggle } from "./theme-toggle";
import { ErrorBox, Loading } from "./ui";
import { useOwnerGate, WalletMenu } from "./wallet";

export const NAV = [
  { href: "/", label: PAGE.home, icon: House },
  { href: "/hoat-dong", label: PAGE.activity, icon: Pulse },
  { href: "/chay-thu", label: PAGE.trial, icon: Play },
  { href: "/quy-tac", label: "Quy tắc", icon: Sliders },
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
    <div
      role="note"
      className="flex min-h-8 items-center gap-2 bg-warning-soft px-4 py-1 text-xs text-warning-soft-foreground sm:px-6"
    >
      <Popover>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Thông tin DEMO MODE"
          className="h-auto px-0 text-xs font-semibold text-inherit"
        >
          DEMO MODE
        </Button>
        <Popover.Content placement="bottom start" className="max-w-72">
          <Popover.Dialog>
            <Popover.Heading>Thông tin mô phỏng</Popover.Heading>
            <p className="text-sm text-muted">
              Oracle, pool, kịch bản tấn công và địa chỉ nhái (khớp 3+3 ký tự) là mô phỏng.
            </p>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <span className="min-w-0">
        {NETWORK === "local" ? "Fork của Avalanche Fuji" : "Mạng thử Avalanche Fuji"}, không có tiền thật.
      </span>
    </div>
  );
}

function Brand() {
  return (
    <NextLink href="/" className="flex h-8 items-center text-lg font-semibold tracking-tight">
      guardian<span className="text-accent">402</span>
    </NextLink>
  );
}

/**
 * The one vault switcher. Signed out or with no linked vault, it shows the demo vault. `onlyWhenMany`: on a
 * phone it opens the page only when there is a choice to make.
 */
function VaultSwitcher({ onlyWhenMany = false }: { onlyWhenMany?: boolean }) {
  const { address, setVault } = useSelectedVault();
  const vaults = useMe().data?.vaults ?? [];
  if (vaults.length < 2) {
    if (onlyWhenMany) return null;
    const v = vaults[0];
    return (
      <div className="flex h-14 min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-default text-muted">
          <Vault aria-hidden="true" className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{v?.label ?? (v ? "Két của tôi" : "Két demo")}</span>
          <span className="font-mono text-xs text-muted" title={address}>
            {shortHex(address)}
          </span>
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

const NAV_ITEM =
  "flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-muted transition-colors hover:bg-default hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-foreground";

export function Sidebar() {
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <aside className="sticky top-0 hidden h-dvh w-62 shrink-0 flex-col gap-4 border-r border-separator bg-surface p-3 lg:flex">
      <div className="px-2 pt-1">
        <Brand />
      </div>
      <VaultSwitcher />
      <nav aria-label="Trang chính" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <NextLink
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={NAV_ITEM}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </NextLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <NextLink
          href="/ve-guardian"
          aria-current={pathname === "/ve-guardian" ? "page" : undefined}
          className={NAV_ITEM}
        >
          <CircleInfo aria-hidden="true" className="size-4 shrink-0" />
          {PAGE.about}
        </NextLink>
        <p className="px-3 text-xs text-muted">
          {NETWORK === "fuji" ? "Mạng thử Fuji" : "Fork của Fuji · DEMO"}
        </p>
      </div>
    </aside>
  );
}

/** The five destinations as a bottom bar below the sidebar breakpoint: reachable with a thumb, no menu to open. */
export function BottomNav() {
  const active = activeHref(usePathname());
  return (
    <nav
      aria-label="Trang chính"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-separator bg-surface px-1 pt-1 pb-[max(8px,env(safe-area-inset-bottom,0px))] lg:hidden"
    >
      {NAV.map(({ href, label, icon: Icon }) => (
        <NextLink
          key={href}
          href={href}
          aria-current={active === href ? "page" : undefined}
          className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium text-muted aria-[current=page]:text-accent"
        >
          <Icon aria-hidden="true" className="size-5" />
          {label}
        </NextLink>
      ))}
    </nav>
  );
}

/** Across every page while the vault is paused: what it means, and that the money is still there. */
export function PausedStrip() {
  const policy = useVaultPolicy();
  if (!policy.data?.paused) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-separator bg-danger-soft px-4 py-2 text-sm text-danger-soft-foreground sm:px-6"
    >
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0">
        <strong className="font-semibold">Két đang khoá.</strong> Agent không chi tiêu được; chủ két vẫn rút
        được tiền.
      </p>
    </div>
  );
}

/** "Đang bảo vệ", and the one emergency lock of the app (it becomes "Mở khoá két" while paused). */
function ProtectionControl() {
  const { address: vault } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const gate = useOwnerGate(p?.owner);
  const { writeContractAsync } = useWriteContract();
  const owner = useOwnerAction();
  if (policy.isPending) return <Skeleton className="h-8 w-32 rounded-full" />;
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
  const label = p.paused ? "Mở khoá két" : "Khoá khẩn cấp";
  const button = (
    <Button
      size="sm"
      variant={p.paused ? "primary" : "danger-soft"}
      aria-label={label}
      className="max-sm:w-9 max-sm:px-0"
      isDisabled={!gate.ok}
      onPress={toggle}
    >
      {p.paused ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
  return (
    <div className="flex items-center gap-2">
      {p.paused ? null : (
        <Chip size="sm" variant="soft" color="success" className="hidden sm:inline-flex">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          <Chip.Label>Đang bảo vệ</Chip.Label>
        </Chip>
      )}
      {gate.ok ? (
        button
      ) : (
        <Tooltip delay={200}>
          <Tooltip.Trigger>
            <span tabIndex={0} aria-label={`${label}: ${gate.message}`}>
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
      <NextLink
        href="/tai-khoan"
        aria-label="Đăng nhập"
        className={buttonVariants({ variant: "ghost", size: "sm", isIconOnly: true })}
      >
        <Avatar size="sm" aria-hidden="true">
          <Avatar.Fallback>
            <Person className="size-4" />
          </Avatar.Fallback>
        </Avatar>
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
    <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-separator bg-background/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <div className="flex min-w-0 items-center lg:hidden">
        <Brand />
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <ProtectionControl />
        <NotificationBell />
        <WalletMenu />
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

/** The main column. Switching vaults remounts the page so drafts and results of the other vault are dropped. */
export function VaultMain({ children }: { children: ReactNode }) {
  const { address, ready } = useSelectedVault();
  const me = useMe();
  const pathname = usePathname();
  const accountFree = pathname === "/tai-khoan" || pathname === "/ve-guardian" || pathname === "/chay-thu";
  return (
    <main
      key={address}
      id="noi-dung"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6"
    >
      {/* Below the sidebar breakpoint the vault switcher opens the page, and only when there is a choice. */}
      <div className="empty:hidden lg:hidden">
        <VaultSwitcher onlyWhenMany />
      </div>
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
