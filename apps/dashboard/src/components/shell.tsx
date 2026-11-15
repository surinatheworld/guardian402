"use client";
// The app frame. Pages inside the app get the sidebar (vault switcher + destinations; a bottom bar on a phone),
// the DEMO strip, the top bar (protection status and the emergency lock, notifications, wallet, account) and
// the paused strip. Sign-in and vault creation get a focused frame with no navigation: there is nothing to
// navigate to yet. The frame also routes: signed out → /dang-nhap; signed in without a vault → /bat-dau.
import {
  ArrowRightFromSquare,
  Bell,
  CircleInfo,
  Cpu,
  Eye,
  House,
  Lock,
  LockOpen,
  Person,
  FileMagnifier,
  Play,
  Plus,
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
import { Popover } from "@heroui/react/popover";
import { Separator } from "@heroui/react/separator";
import { Skeleton } from "@heroui/react/skeleton";
import { Spinner } from "@heroui/react/spinner";
import { toast } from "@heroui/react/toast";
import { Tooltip } from "@heroui/react/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
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
  { href: "/quy-tac", label: PAGE.rules, short: "Quy tắc", icon: Sliders },
  { href: "/agent", label: PAGE.agents, icon: Cpu },
] as const;
const DEMO_NAV = { href: "/chay-thu", label: PAGE.trial, icon: Play } as const;
/** Any wallet, no vault needed: a transaction checked before it is signed. */
const WALLET_NAV = { href: "/kiem-tra-vi", label: PAGE.walletCheck, icon: FileMagnifier } as const;

/** Routes without the app navigation: sign-in and the guided vault creation. */
const FOCUS_ROUTES = ["/dang-nhap", "/bat-dau"];
/** Routes anyone may open signed out. */
const PUBLIC_ROUTES = ["/dang-nhap", "/ve-guardian", "/kiem-tra-vi"];
/** Routes a signed-in user without a vault may open (everything else sends them to /bat-dau). */
const NO_VAULT_ROUTES = ["/bat-dau", "/tai-khoan", "/ve-guardian", "/chay-thu", "/kiem-tra-vi"];

const activeHref = (pathname: string) =>
  [...NAV, DEMO_NAV, WALLET_NAV].find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  )?.href ?? "";

// ------------------------------------------------------------------ pieces

/** `markOnlyOnPhone`: the top bar on a phone shows the mark alone, so the demo chip and wallet fit one row. */
export function Brand({
  size = "md",
  markOnlyOnPhone = false,
}: {
  size?: "md" | "lg";
  markOnlyOnPhone?: boolean;
}) {
  return (
    <NextLink
      href="/"
      aria-label="Guardian402, về Tổng quan"
      className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-lg bg-brand text-white ${size === "lg" ? "size-10" : "size-8"}`}
      >
        <ShieldCheck className={size === "lg" ? "size-5" : "size-4"} />
      </span>
      <span
        className={`font-semibold tracking-tight ${size === "lg" ? "text-xl" : "text-base"} ${markOnlyOnPhone ? "max-sm:sr-only" : ""}`}
      >
        Guardian402
      </span>
    </NextLink>
  );
}

export function DemoBanner() {
  const guardian = useGuardianHealth();
  const agent = useAgentHealth();
  const demo = guardian.data?.demoMode === true || agent.isSuccess;
  if (!demo) return null;
  return (
    <div
      role="note"
      className="flex min-h-8 items-center gap-2 bg-surface-secondary px-4 py-1 text-xs text-foreground sm:px-6"
    >
      <Popover>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Thông tin DEMO MODE"
          className="h-auto min-h-6 px-0 text-xs font-semibold text-inherit"
        >
          DEMO MODE
        </Button>
        <Popover.Content placement="bottom start" className="max-w-72">
          <Popover.Dialog>
            <Popover.Heading>Phần mô phỏng</Popover.Heading>
            <p className="text-sm text-muted">
              Bảng giá, sàn swap, kịch bản tấn công và địa chỉ nhái (khớp 3+3 ký tự) là mô phỏng. Két, hạn
              mức, chữ ký của Guardian và phí x402 là thật trên mạng thử.
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

/** The vault switcher: your vaults, the demo vault, and "Tạo két mới". */
function VaultSwitcher() {
  const { address, viewingDemo, setVault, setViewingDemo } = useSelectedVault();
  const me = useMe();
  const router = useRouter();
  const vaults = me.data?.vaults ?? [];
  const current = vaults.find((v) => v.address.toLowerCase() === address.toLowerCase());
  const title = viewingDemo ? "Két demo" : (current?.label ?? "Két của tôi");
  return (
    <Dropdown>
      <Button
        variant="ghost"
        aria-label={`Két đang xem: ${title}. Đổi két`}
        className="h-auto w-full justify-start gap-3 rounded-xl border border-border px-2 py-2 hover:bg-default"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-default text-foreground/70">
          <Vault aria-hidden="true" className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col items-start">
          <span className="max-w-full truncate text-sm font-medium">{title}</span>
          <span className="font-mono text-xs text-muted">{shortHex(address)}</span>
        </span>
      </Button>
      <Dropdown.Popover placement="bottom start" className="min-w-64">
        <Dropdown.Menu
          aria-label="Chọn két"
          onAction={(key) => {
            const k = String(key);
            if (k === "new") router.push("/bat-dau");
            else if (k === "demo") {
              setViewingDemo(true);
              router.push("/");
            } else {
              setVault(k);
              router.push("/");
            }
          }}
        >
          {vaults.map((v) => (
            <Dropdown.Item key={v.address} id={v.address} textValue={v.label ?? v.address}>
              <div className="flex min-w-0 flex-col">
                <Label>{v.label ?? "Két của tôi"}</Label>
                <span className="font-mono text-xs text-muted">{shortHex(v.address)}</span>
              </div>
            </Dropdown.Item>
          ))}
          <Dropdown.Item id="demo" textValue="Két demo">
            <Eye aria-hidden="true" className="size-4 text-muted" />
            <div className="flex min-w-0 flex-col">
              <Label>Két demo</Label>
              <span className="text-xs text-muted">Chỉ xem, dữ liệu mạng thử</span>
            </div>
          </Dropdown.Item>
          {me.data ? (
            <Dropdown.Item id="new" textValue="Tạo két mới">
              <Plus aria-hidden="true" className="size-4 text-muted" />
              <Label>Tạo két mới</Label>
            </Dropdown.Item>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

// Sidebar links (ui-ux skill, layouts/app/shell.md): 40px, regular weight at 70% foreground so names stay readable;
// hover is the neutral fill; the current page takes the accent (a tinted accent marks the current item).
const NAV_ITEM =
  "flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm text-foreground/70 transition-colors hover:bg-default hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-soft-foreground aria-[current=page]:hover:bg-accent-soft";
const GROUP_LABEL = "px-3 pt-4 pb-1 text-xs font-medium tracking-wide text-muted uppercase";

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof House;
  short?: string;
}) {
  const active = activeHref(usePathname());
  return (
    <NextLink href={href} aria-current={active === href ? "page" : undefined} className={NAV_ITEM}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {label}
    </NextLink>
  );
}

/**
 * The trial page simulates through the Guardian's free DEMO endpoint, so it is offered whenever the Guardian runs
 * in DEMO mode: also on a deployment with no agent control API, where the page only simulates.
 */
function useTrialAvailable() {
  const guardian = useGuardianHealth();
  const agent = useAgentHealth();
  return guardian.data?.demoMode === true || agent.isSuccess;
}

function Sidebar() {
  const pathname = usePathname();
  const trial = useTrialAvailable();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 overflow-y-auto bg-surface px-3 py-4 lg:flex">
      <div className="flex h-8 items-center px-2">
        <Brand />
      </div>
      <VaultSwitcher />
      <nav aria-label="Trang chính" className="flex flex-col gap-1">
        {NAV.map((n) => (
          <NavLink key={n.href} {...n} />
        ))}
      </nav>
      {trial ? (
        <nav aria-label="Demo" className="-mt-3 flex flex-col gap-1">
          <span className={GROUP_LABEL}>Demo</span>
          <NavLink {...DEMO_NAV} />
          <NavLink {...WALLET_NAV} />
        </nav>
      ) : null}
      <div className="mt-auto flex flex-col gap-1">
        <NextLink
          href="/ve-guardian"
          aria-current={pathname === "/ve-guardian" ? "page" : undefined}
          className={NAV_ITEM}
        >
          <CircleInfo aria-hidden="true" className="size-4 shrink-0" />
          {PAGE.about}
        </NextLink>
        <p className="px-3 pt-1 text-xs text-muted">
          {NETWORK === "fuji" ? "Avalanche Fuji · mạng thử" : "Fork của Fuji · DEMO"}
        </p>
      </div>
    </aside>
  );
}

/** The destinations as a bottom bar below the sidebar breakpoint: reachable with a thumb, no menu to open. */
function BottomNav() {
  const active = activeHref(usePathname());
  const trial = useTrialAvailable();
  const items = trial ? [...NAV, DEMO_NAV] : NAV;
  return (
    <nav
      aria-label="Trang chính"
      className={`fixed inset-x-0 bottom-0 z-30 grid border-t border-separator bg-surface px-1 pt-1 pb-[max(8px,env(safe-area-inset-bottom,0px))] lg:hidden ${trial ? "grid-cols-5" : "grid-cols-4"}`}
    >
      {items.map((n) => {
        const Icon = n.icon;
        return (
          <NextLink
            key={n.href}
            href={n.href}
            aria-current={active === n.href ? "page" : undefined}
            className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium text-foreground/70 aria-[current=page]:text-accent"
          >
            <Icon aria-hidden="true" className="size-5" />
            {"short" in n ? n.short : n.label}
          </NextLink>
        );
      })}
    </nav>
  );
}

/** Across every page while the vault is paused: what it means, and that the money is still there. */
function PausedStrip() {
  const policy = useVaultPolicy();
  if (!policy.data?.paused) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-danger-soft px-4 py-2 text-sm text-danger-soft-foreground sm:px-6"
    >
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0">
        <strong className="font-semibold">Két đang khoá.</strong> Agent không chi tiêu được; bạn vẫn rút được
        tiền.
      </p>
    </div>
  );
}

/** "Đang bảo vệ", and the one emergency lock of the app (it becomes "Mở khoá két" while paused). */
function ProtectionControl() {
  const { address: vault, viewingDemo } = useSelectedVault();
  const policy = useVaultPolicy();
  const p = policy.data;
  const gate = useOwnerGate(p?.owner);
  const { writeContractAsync } = useWriteContract();
  const owner = useOwnerAction();
  if (policy.isPending) return <Skeleton className="h-8 w-32 rounded-full" />;
  if (!p) return null;
  const send = (functionName: "pause" | "unpause") => () =>
    writeContractAsync({ address: vault, abi: agentVaultAbi, functionName, chainId: avalancheFuji.id });
  const toggle = () =>
    owner.request(
      p.paused
        ? {
            title: "Mở khoá két",
            summary: "Agent được chi tiêu trở lại, vẫn trong hạn mức và danh sách người nhận.",
            changes: [{ label: "Trạng thái", before: "Đã khoá", after: "Đang bảo vệ" }],
            call: "AgentVault.unpause()",
            confirmLabel: "Ký và mở khoá",
            successTitle: "Đã mở khoá két",
            send: send("unpause"),
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
            send: send("pause"),
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
      {viewingDemo ? null : gate.ok ? (
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
  const { address: vault, viewingDemo } = useSelectedVault();
  const me = useMe();
  const linked = me.data?.vaults.some((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? false;
  if (!linked || viewingDemo) return null;
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
          <NextLink href="/hoat-dong" className={buttonVariants({ variant: "tertiary", size: "sm" })}>
            Xem hoạt động
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
  const { setViewingDemo } = useSelectedVault();
  const logout = useMutation({
    mutationFn: () => accountApi("/api/auth/logout", "POST"),
    onSuccess: async () => {
      setViewingDemo(false);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast("Đã đăng xuất");
      router.push("/dang-nhap");
    },
  });
  if (me.isPending) return <Skeleton className="size-8 rounded-full" />;
  if (!me.data)
    return (
      <>
        {/* Below the sidebar breakpoint a signed-out visitor has no account menu: keep "Về Guardian" reachable. */}
        <NextLink
          href="/ve-guardian"
          aria-label={PAGE.about}
          className={`${buttonVariants({ variant: "ghost", size: "sm", isIconOnly: true })} lg:hidden`}
        >
          <CircleInfo aria-hidden="true" />
        </NextLink>
        <NextLink href="/dang-nhap" className={buttonVariants({ variant: "primary", size: "sm" })}>
          <Person aria-hidden="true" />
          Đăng nhập
        </NextLink>
      </>
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
            <ArrowRightFromSquare aria-hidden="true" className="size-4" />
            <Label>Đăng xuất</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/** While the demo vault is shown: say so, and the way out. */
function DemoViewChip() {
  const { viewingDemo, demoChosen, setViewingDemo } = useSelectedVault();
  const me = useMe();
  const router = useRouter();
  if (!viewingDemo) return null;
  return (
    <div className="flex items-center gap-2">
      <Chip size="sm" variant="soft" color="default">
        <Eye aria-hidden="true" className="size-3.5" />
        <Chip.Label>
          Két demo<span className="hidden sm:inline"> · chỉ xem</span>
        </Chip.Label>
      </Chip>
      {demoChosen ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={() => {
            setViewingDemo(false);
            router.push(me.data ? "/" : "/dang-nhap");
          }}
        >
          Thoát
        </Button>
      ) : null}
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-x-2 bg-background/85 px-4 py-2 backdrop-blur sm:gap-x-3 sm:px-6">
      <div className="flex shrink-0 items-center lg:hidden">
        <Brand markOnlyOnPhone />
      </div>
      <DemoViewChip />
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
        <ProtectionControl />
        <NotificationBell />
        <WalletMenu />
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
        <div className="hidden sm:flex">
          <ThemeToggle />
        </div>
        <AccountMenu />
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ frames

function FullPageLoading() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center">
      <span className="flex items-center gap-2 text-sm text-muted">
        <Spinner size="sm" color="current" />
        Đang tải…
      </span>
    </div>
  );
}

/** Where the visitor may be, given the session and the vaults; null = stay. */
function redirectFor(
  pathname: string,
  signedIn: boolean,
  hasOwnVault: boolean,
  demoChosen: boolean,
): string | null {
  if (!signedIn && !demoChosen && !PUBLIC_ROUTES.includes(pathname))
    return `/dang-nhap${pathname === "/" ? "" : `?quay-lai=${encodeURIComponent(pathname)}`}`;
  if (signedIn && !hasOwnVault && !demoChosen && !NO_VAULT_ROUTES.includes(pathname)) return "/bat-dau";
  if (signedIn && pathname === "/dang-nhap") return "/";
  return null;
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const { address, ready, hasOwnVault, demoChosen } = useSelectedVault();
  const settled = ready && !me.isPending && !me.isError;
  const target = settled ? redirectFor(pathname, Boolean(me.data), hasOwnVault, demoChosen) : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (me.isError)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorBox
          title="Không đọc được tài khoản"
          detail="Máy chủ của dashboard chưa trả lời. Hãy thử lại."
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  if (!settled || target) return <FullPageLoading />;

  if (FOCUS_ROUTES.includes(pathname))
    return (
      <div className="flex min-h-dvh flex-col">
        <DemoBanner />
        <header className="flex min-h-16 items-center gap-3 px-4 sm:px-8">
          <Brand />
          <div className="ml-auto flex items-center gap-2">
            {pathname === "/bat-dau" ? <WalletMenu /> : null}
            <ThemeToggle />
            {me.data ? <AccountMenu /> : null}
          </div>
        </header>
        <main id="noi-dung" className="flex w-full flex-1 flex-col px-4 pb-16 sm:px-8">
          {children}
        </main>
      </div>
    );

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <TopBar />
        <PausedStrip />
        {/* Switching vaults remounts the page so drafts and results of the other vault are dropped. */}
        <main
          key={address}
          id="noi-dung"
          className="mx-auto flex w-full max-w-[1160px] flex-col gap-6 px-4 pt-2 pb-24 sm:px-6 lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export const isDemoVault = (vault: string) => vault.toLowerCase() === deployment.vault.toLowerCase();
