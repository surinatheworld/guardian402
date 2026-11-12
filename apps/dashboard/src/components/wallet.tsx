"use client";
// The owner's wallet: connect, switch to Fuji, disconnect, and the gate every owner action goes through.
// The dashboard holds no key: owner actions are signed in the wallet (Core or MetaMask).
import { Wallet } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { NETWORK } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { Notice } from "./ui";

export function ConnectWalletButton({
  size = "md",
  variant = "primary",
  compact = false,
}: {
  size?: "sm" | "md";
  variant?: "primary" | "tertiary";
  /** Icon only below `sm` (top bar on a phone). */
  compact?: boolean;
}) {
  const { connect, connectors, isPending, error } = useConnect();
  const connector = connectors[0];
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        isDisabled={!connector}
        isPending={isPending}
        aria-label="Kết nối ví"
        onPress={() => connector && connect({ connector, chainId: avalancheFuji.id })}
      >
        <Wallet aria-hidden="true" />
        <span className={compact ? "hidden sm:inline" : ""}>{isPending ? "Đang mở ví…" : "Kết nối ví"}</span>
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          Không kết nối được ví: {error.message.split("\n")[0]}
        </span>
      ) : null}
    </div>
  );
}

/** Wallet status for the top bar: a connect button, or the connected address with switch and disconnect. */
export function WalletMenu() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  if (NETWORK === "local") return null;
  if (!isConnected || !address) return <ConnectWalletButton size="sm" variant="tertiary" compact />;
  const wrongChain = chainId !== avalancheFuji.id;
  return (
    <Dropdown>
      <Button variant="tertiary" size="sm" aria-label={`Ví ${address}`}>
        <Wallet aria-hidden="true" />
        <span className="font-mono text-xs">{shortHex(address)}</span>
        {wrongChain ? (
          <Chip color="warning" variant="soft" size="sm">
            Sai mạng
          </Chip>
        ) : null}
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-56">
        <Dropdown.Menu
          aria-label="Ví"
          onAction={(key) => {
            if (key === "fuji") switchChain({ chainId: avalancheFuji.id });
            if (key === "disconnect") disconnect();
          }}
        >
          {wrongChain ? (
            <Dropdown.Item id="fuji" textValue="Chuyển sang Fuji">
              <Label>Chuyển sang mạng Fuji</Label>
            </Dropdown.Item>
          ) : null}
          <Dropdown.Item id="disconnect" textValue="Ngắt kết nối ví" variant="danger">
            <Label>Ngắt kết nối ví</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export type OwnerGate =
  { ok: true } | { ok: false; reason: "local" | "no-wallet" | "wrong-wallet" | "loading"; message: string };

/** Whether the connected wallet can sign owner transactions for a vault whose owner is `owner`. */
export function useOwnerGate(owner: Address | undefined): OwnerGate {
  const { address, isConnected } = useAccount();
  if (NETWORK === "local")
    return {
      ok: false,
      reason: "local",
      message: "Bản demo chạy trên fork nên không ký được giao dịch ví.",
    };
  if (!owner) return { ok: false, reason: "loading", message: "Đang đọc chủ két trên chain…" };
  if (!isConnected || !address)
    return { ok: false, reason: "no-wallet", message: "Kết nối ví chủ két để thay đổi." };
  if (address.toLowerCase() !== owner.toLowerCase())
    return {
      ok: false,
      reason: "wrong-wallet",
      message: `Ví đang kết nối (${shortHex(address)}) không phải chủ két (${shortHex(owner)}).`,
    };
  return { ok: true };
}

/** One notice per page that says why owner actions are unavailable and what to do. */
export function OwnerGateNotice({ gate, children }: { gate: OwnerGate; children?: ReactNode }) {
  if (gate.ok || gate.reason === "loading") return null;
  if (gate.reason === "local")
    return (
      <Notice title="Xem được, chưa sửa được">
        Bản demo này chạy trên fork, nơi không có ví để ký. Để thay đổi két, mở dashboard ở mạng Fuji (
        <code className="font-mono text-xs">NEXT_PUBLIC_NETWORK=fuji</code>) và kết nối ví chủ két.
        {children}
      </Notice>
    );
  if (gate.reason === "no-wallet")
    return (
      <Notice title="Kết nối ví chủ két để thay đổi" action={<ConnectWalletButton size="sm" />}>
        Mọi thay đổi được ký trong ví của bạn. Dashboard không giữ khoá nào.
      </Notice>
    );
  return (
    <Notice status="warning" title="Ví này không phải chủ két">
      {gate.message} Két sẽ từ chối giao dịch; hãy chuyển sang ví chủ trong ví của bạn.
    </Notice>
  );
}
