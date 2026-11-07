"use client";
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
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={!connector || isPending}
          onClick={() => connector && connect({ connector, chainId: avalancheFuji.id })}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-60"
        >
          {isPending ? "Đang kết nối…" : "Kết nối ví"}
        </button>
        {error ? (
          <span className="text-xs text-high">Không kết nối được ví: {error.message.split("\n")[0]}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {chainId !== avalancheFuji.id ? (
        <button
          type="button"
          onClick={() => switchChain({ chainId: avalancheFuji.id })}
          className="rounded-lg border border-medium bg-medium-bg px-2 py-1 text-xs font-semibold text-medium"
        >
          Chuyển sang Fuji
        </button>
      ) : null}
      <span className="font-mono text-xs" title={address}>
        {shortHex(address)}
      </span>
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-lg border border-line px-2 py-1 text-xs"
      >
        Ngắt
      </button>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-[max(16px,env(safe-area-inset-left,0px))] py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">Guardian402</span>
            <span className="text-xs text-muted">
              tường lửa giao dịch cho ví agent · {NETWORK === "fuji" ? "Fuji" : "fork"}
            </span>
          </Link>
          <WalletButton />
        </div>
        <nav aria-label="Trang">
          <ul className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <li key={n.href} className="shrink-0">
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg px-3 py-1.5 text-sm ${
                      active ? "bg-accent font-semibold text-accent-fg" : "text-fg hover:bg-surface-2"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
