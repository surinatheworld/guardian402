"use client";
import { Button } from "@heroui/react/button";
// Header (brand, wallet), navigation and the DEMO MODE banner.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { useAgentHealth, useGuardianHealth } from "@/lib/api";
import { NETWORK } from "@/lib/config";
import { shortHex } from "@/lib/format";

const NAV = [
  { href: "/", label: "Tổng quan" },
  { href: "/hoat-dong", label: "Hoạt động" },
  { href: "/da-chan", label: "Đã chặn" },
  { href: "/doanh-thu", label: "Doanh thu" },
  { href: "/kiem-tra", label: "Kiểm tra giao dịch" },
  { href: "/dieu-khien", label: "Điều khiển" },
] as const;

export function DemoBanner() {
  const guardian = useGuardianHealth();
  const agent = useAgentHealth();
  const demo = guardian.data?.demoMode === true || agent.isSuccess;
  if (!demo) return null;
  return (
    <div role="note" className="bg-demo-bg text-demo">
      <p className="mx-auto max-w-6xl px-[max(16px,env(safe-area-inset-left,0px))] py-2 text-sm">
        <strong className="mr-2 tracking-wide">DEMO MODE</strong>
        Mạng thử Avalanche Fuji, không có tiền thật. Oracle, pool, kịch bản tấn công và địa chỉ nhái (khớp 3+3
        ký tự) là mô phỏng.
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
  return (
    <aside className="h3-sidebar">
      <Link href="/" className="h3-brand">
        guardian<span>402</span>
      </Link>
      <div className="h3-workspace">
        <span className="h3-workspace-name">Guardian Workspace</span>
      </div>
      <nav className="h3-nav" aria-label="Trang">
        {NAV.map((n) => {
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
      </nav>
      <div className="h3-sidebar-bottom">
        <div className="h3-network">
          <span className="h3-dot" />
          Avalanche Fuji
        </div>
        <p>Testnet · {NETWORK === "fuji" ? "Fuji" : "fork"}</p>
        <div className="h3-owner">
          <span className="h3-owner-label">Ví chủ</span>
          <WalletButton />
        </div>
      </div>
    </aside>
  );
}

export function WorkspaceBar() {
  const pathname = usePathname();
  const current = NAV.find((item) => item.href === pathname)?.label ?? "Tổng quan";
  return (
    <div className="h3-topbar">
      <span>
        Workspace <span className="h3-breadcrumb-slash">/</span>{" "}
        <strong className="font-semibold text-fg">{current}</strong>
      </span>
      <span className="rounded-full bg-surface px-3 py-1 font-semibold">
        {NETWORK === "fuji" ? "Fuji testnet" : "Fork Fuji"}
      </span>
    </div>
  );
}
