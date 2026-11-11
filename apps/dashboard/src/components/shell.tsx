"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
// Header (brand, wallet), navigation and the DEMO MODE banner.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { useAgentHealth, useGuardianHealth } from "@/lib/api";
import { NETWORK } from "@/lib/config";
import { useMe } from "@/lib/account";
import { ErrorBox, Loading } from "@/components/ui";
import { useSelectedVault } from "@/lib/vault-context";
import { PolicySelect } from "@/components/workspace/policy-fields";
import { shortHex } from "@/lib/format";

const NAV = [
  { href: "/", label: "Tổng quan" },
  { href: "/hoat-dong", label: "Hoạt động" },
  { href: "/da-chan", label: "Đã chặn" },
  { href: "/kiem-tra", label: "Kiểm tra giao dịch" },
  { href: "/dieu-khien", label: "Điều khiển" },
  { href: "/quan-ly", label: "Quản lý vault" },
  { href: "/demo", label: "Thử demo" },
  { href: "/doanh-thu", label: "Doanh thu" },
  { href: "/tai-khoan", label: "Tài khoản" },
] as const;

const PRIMARY_NAV = NAV.filter((item) =>
  ["/", "/hoat-dong", "/kiem-tra", "/dieu-khien", "/quan-ly", "/demo"].includes(item.href),
);
const MORE_NAV = NAV.filter((item) => !PRIMARY_NAV.includes(item));

export function DemoBanner() {
  const guardian = useGuardianHealth();
  const agent = useAgentHealth();
  const demo = guardian.data?.demoMode === true || agent.isSuccess;
  if (!demo) return null;
  return (
    <div role="note" className="bg-demo-bg text-demo">
      <p className="mx-auto max-w-6xl px-[max(16px,env(safe-area-inset-left,0px))] py-2 text-sm">
        <strong className="mr-2 tracking-wide">DEMO MODE</strong>
        {NETWORK === "local" ? "Fork Avalanche Fuji" : "Mạng thử Avalanche Fuji"}, không có tiền thật. Oracle,
        pool, kịch bản tấn công và địa chỉ nhái (khớp 3+3 ký tự) là mô phỏng.
      </p>
    </div>
  );
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const connector = connectors[0];

  if (NETWORK === "local") return <span className="text-xs text-muted">Fork demo · không kết nối ví</span>;

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="primary"
          type="button"
          isDisabled={!connector || isPending}
          onPress={() => connector && connect({ connector, chainId: avalancheFuji.id })}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-60"
        >
          {isPending ? "Đang kết nối…" : "Kết nối ví"}
        </Button>
        {error ? (
          <span className="text-xs text-high">Không kết nối được ví: {error.message.split("\n")[0]}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-start gap-2">
      {chainId !== avalancheFuji.id ? (
        <Button
          variant="secondary"
          type="button"
          onPress={() => switchChain({ chainId: avalancheFuji.id })}
          className="rounded-lg border border-medium bg-medium-bg px-2 py-1 text-xs font-semibold text-medium"
        >
          Chuyển sang Fuji
        </Button>
      ) : null}
      <span className="font-mono text-xs" title={address}>
        {shortHex(address)}
      </span>
      <Button
        variant="secondary"
        type="button"
        onPress={() => disconnect()}
        className="rounded-lg border border-line px-2 py-1 text-xs"
      >
        Ngắt
      </Button>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const moreActive = MORE_NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const showActive = () => {
      if (nav.scrollWidth <= nav.clientWidth) return;
      const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2);
    };
    const observer = new ResizeObserver(showActive);
    observer.observe(nav);
    observer.observe(active);
    showActive();
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <aside className="h3-sidebar">
      <Link href="/" className="h3-brand">
        guardian<span>402</span>
      </Link>
      <div className="h3-workspace">
        <span className="h3-workspace-name">Guardian Workspace</span>
      </div>
      <nav ref={navRef} className="h3-nav" aria-label="Trang">
        {PRIMARY_NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`h3-nav-button flex items-center ${active ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2"}`}
            >
              {n.label}
            </Link>
          );
        })}
        <Dropdown>
          <Button
            variant={moreActive ? "primary" : "ghost"}
            aria-label={moreActive ? `Thêm: ${moreActive.label}` : "Các trang khác"}
            aria-current={moreActive ? "page" : false}
            className="h3-nav-more"
          >
            <span>{moreActive?.label ?? "Thêm"}</span>
          </Button>
          <Dropdown.Popover placement="bottom start" className="min-w-[190px]">
            <Dropdown.Menu aria-label="Các trang khác">
              {MORE_NAV.map((item) => (
                <Dropdown.Item key={item.href} id={item.href} href={item.href} textValue={item.label}>
                  <Label>{item.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </nav>
      {NETWORK !== "local" ? (
        <div className="h3-sidebar-bottom">
          <div className="h3-owner">
            <span className="h3-owner-label">Ví chủ</span>
            <WalletButton />
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function WorkspaceBar() {
  const pathname = usePathname();
  const current = NAV.find((item) => item.href === pathname)?.label ?? "Tổng quan";
  const { address, setVault } = useSelectedVault();
  const vaults = useMe().data?.vaults ?? [];
  return (
    <div className="h3-topbar">
      <span>
        Workspace <span className="h3-breadcrumb-slash">/</span>{" "}
        <strong className="font-semibold text-fg">{current}</strong>
      </span>
      <div className="h3-topbar-context">
        {vaults.length > 1 ? (
          <PolicySelect
            label="Vault"
            value={address}
            onChange={setVault}
            options={vaults.map((v) => ({
              id: v.address,
              label: `${v.label ?? "AgentVault"} · ${shortHex(v.address)}`,
            }))}
          />
        ) : (
          <span title={address} className="text-xs text-muted">
            {vaults[0]?.label ?? (vaults.length ? "AgentVault" : "Vault demo")} · {shortHex(address)}
          </span>
        )}
        <Chip variant="secondary" size="sm">
          {NETWORK === "fuji" ? "Fuji testnet" : "Fork Fuji"}
        </Chip>
      </div>
    </div>
  );
}

/** Reset page-local drafts and results when switching vaults. */
export function VaultMain({ children }: { children: ReactNode }) {
  const { address, ready } = useSelectedVault();
  const me = useMe();
  const pathname = usePathname();
  return (
    <main key={address} id="noi-dung" className="h3-content flex flex-col gap-6">
      {me.isPending || !ready ? (
        <Loading label="Đang tải workspace…" />
      ) : me.isError && pathname !== "/demo" && pathname !== "/tai-khoan" ? (
        <ErrorBox
          title="Không xác định được vault"
          detail="Không tải được tài khoản để xác định vault đang chọn. Hãy thử lại."
          onRetry={() => void me.refetch()}
        />
      ) : (
        children
      )}
    </main>
  );
}
