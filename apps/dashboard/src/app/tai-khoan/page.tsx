"use client";
// Tài khoản (signed in; signing in is /dang-nhap): linked vaults (create a new one, or link one you own),
// wallets and the profile. The account database is off-chain and never holds keys; balances, rules and
// ownership are always read from the chain.
import { ArrowRight, Plus, TrashBin } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { EditModal } from "@/components/edit-modal";
import { TextInput, useConfirm } from "@/components/fields";
import { errorOf } from "@/components/form";
import { AddressLink, Card, Empty, ErrorBox, Expand, Facts, LoadingRows, PageHeader } from "@/components/ui";
import { ConnectWalletButton } from "@/components/wallet";
import {
  accountApi,
  eventLabel,
  signInWithWallet,
  useMe,
  useRefreshMe,
  type MeResponse,
} from "@/lib/account";
import { deployment, NETWORK } from "@/lib/config";
import { formatTime, shortHex } from "@/lib/format";
import { PAGE } from "@/lib/labels";
import { useSelectedVault } from "@/lib/vault-context";

export default function AccountPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title={PAGE.account} />
      {me.isPending ? (
        <LoadingRows rows={3} label="Đang tải tài khoản" />
      ) : me.isError ? (
        <ErrorBox
          title="Không đọc được tài khoản"
          detail={errorOf(me.error)}
          onRetry={() => void me.refetch()}
        />
      ) : me.data ? (
        <SignedIn me={me.data} />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ signed in

function SignedIn({ me }: { me: MeResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <Vaults me={me} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Wallets me={me} />
        <Profile me={me} />
      </div>
      <Card title="Lịch sử bảo mật">
        {me.events.length === 0 ? (
          <Empty>Chưa có sự kiện nào.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-separator text-sm">
            {me.events.slice(0, 12).map((e, i) => (
              <li
                key={`${e.createdAt}-${i}`}
                className="flex flex-wrap justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <span>
                  {eventLabel(e.event)}
                  {typeof e.detail?.address === "string" ? (
                    <span className="ml-2 font-mono text-xs text-muted">{shortHex(e.detail.address)}</span>
                  ) : null}
                </span>
                <span className="text-muted tabular-nums">{formatTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Vaults({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const router = useRouter();
  const confirm = useConfirm();
  const { address: selected, setVault } = useSelectedVault();
  const [open, setOpen] = useState(false);
  const [vault, setVaultInput] = useState<string>(deployment.vault);
  const [label, setLabel] = useState("");
  const link = useMutation({
    mutationFn: () => accountApi("/api/account/vaults", "POST", { address: vault.trim(), label }),
    onSuccess: async () => {
      setLabel("");
      setOpen(false);
      await refresh();
      setVault(vault.trim());
      toast.success("Đã liên kết két", { description: "Dashboard đang hiển thị két này." });
    },
  });
  return (
    <Card
      title="Két của bạn"
      description="Chỉ liên kết được két mà chủ trên chain là một ví của bạn"
      actions={
        <>
          <Button size="sm" variant="primary" onPress={() => router.push("/bat-dau")}>
            <Plus aria-hidden="true" />
            Tạo két mới
          </Button>
          <Button size="sm" variant="tertiary" onPress={() => setOpen(true)}>
            Liên kết két có sẵn
          </Button>
        </>
      }
    >
      {me.vaults.length === 0 ? (
        <Empty
          action={
            <Button size="sm" variant="primary" onPress={() => setOpen(true)}>
              Liên kết két
            </Button>
          }
        >
          Chưa liên kết két nào. {me.wallets.length === 0 ? "Hãy liên kết ví chủ két trước." : ""}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-separator">
          {me.vaults.map((v) => {
            const current = v.address.toLowerCase() === selected.toLowerCase();
            return (
              <li
                key={v.address}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {v.label ?? "Két"}
                    {current ? (
                      <Chip size="sm" variant="soft" color="accent">
                        Đang xem
                      </Chip>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted">
                    <AddressLink address={v.address} /> · chủ {shortHex(v.ownerWallet)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {!current ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setVault(v.address);
                        router.push("/");
                      }}
                    >
                      Xem
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Gỡ ${v.label ?? v.address} khỏi tài khoản`}
                    onPress={() =>
                      confirm.ask({
                        title: "Gỡ két khỏi tài khoản?",
                        body: "Agent, bộ quy tắc và cảnh báo của két này trong dashboard bị gỡ theo. Két trên chain không đổi gì.",
                        confirmLabel: "Gỡ két",
                        onConfirm: async () => {
                          await accountApi(`/api/account/vaults/${v.address}`, "DELETE");
                          await refresh();
                          toast("Đã gỡ két khỏi tài khoản");
                        },
                      })
                    }
                  >
                    <TrashBin aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <EditModal
        isOpen={open}
        onOpenChange={(o) => {
          link.reset();
          setOpen(o);
        }}
        title="Liên kết két"
        submitLabel={link.isPending ? "Đang đọc chủ két trên chain…" : "Liên kết"}
        isSubmitDisabled={link.isPending || !isAddress(vault.trim())}
        onSubmit={() => link.mutate()}
      >
        <TextInput
          label="Địa chỉ két (AgentVault)"
          value={vault}
          onChange={setVaultInput}
          mono
          isRequired
          error={
            vault.trim() && !isAddress(vault.trim())
              ? "Địa chỉ phải có dạng 0x và 40 ký tự hex."
              : link.error
                ? errorOf(link.error)
                : null
          }
        />
        <TextInput label="Tên gợi nhớ (không bắt buộc)" value={label} onChange={setLabel} maxLength={40} />
      </EditModal>
      {confirm.dialog}
    </Card>
  );
}

function Wallets({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const confirm = useConfirm();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const link = useMutation({
    mutationFn: () => {
      if (!address) throw new Error("Hãy kết nối ví trước.");
      return signInWithWallet(address, signMessageAsync);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Đã liên kết ví");
    },
    onError: (e) => toast.danger("Chưa liên kết được ví", { description: errorOf(e) }),
  });
  const connectedLinked = me.wallets.some((w) => w.address.toLowerCase() === address?.toLowerCase());
  return (
    <Card title="Ví đã liên kết" description="Mỗi ví được thêm bằng một chữ ký chứng minh bạn giữ ví đó">
      {me.wallets.length === 0 ? (
        <Empty>Chưa có ví nào.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-separator">
          {me.wallets.map((w) => (
            <li
              key={w.address}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center gap-2">
                <AddressLink address={w.address} />
                {w.isPrimary ? (
                  <Chip size="sm" variant="tertiary">
                    Ví chính
                  </Chip>
                ) : null}
              </span>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={`Gỡ ví ${w.address}`}
                onPress={() =>
                  confirm.ask({
                    title: "Gỡ ví này?",
                    body: "Các két liên kết qua ví này cũng bị gỡ khỏi tài khoản. Không đổi gì trên chain.",
                    confirmLabel: "Gỡ ví",
                    onConfirm: async () => {
                      await accountApi(`/api/account/wallets/${w.address}`, "DELETE");
                      await refresh();
                      toast("Đã gỡ ví");
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
      {NETWORK === "local" ? (
        <p className="text-xs text-muted">Bản demo trên fork không kết nối ví.</p>
      ) : !isConnected ? (
        <ConnectWalletButton size="sm" variant="tertiary" />
      ) : connectedLinked ? (
        <p className="text-xs text-muted">Ví đang kết nối đã liên kết.</p>
      ) : (
        <Button
          size="sm"
          variant="tertiary"
          className="self-start"
          isPending={link.isPending}
          onPress={() => link.mutate()}
        >
          Ký để liên kết ví {address ? shortHex(address) : ""}
        </Button>
      )}
      {confirm.dialog}
    </Card>
  );
}

function Profile({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const router = useRouter();
  const u = me.user;
  const [name, setName] = useState(u.displayName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () => accountApi("/api/account/profile", "PATCH", { displayName: name }),
    onSuccess: async () => {
      await refresh();
      toast.success("Đã lưu tên hiển thị");
    },
    onError: (e) => toast.danger("Chưa lưu được", { description: errorOf(e) }),
  });
  const addPassword = useMutation({
    mutationFn: () => accountApi("/api/account/password", "POST", { email, password }),
    onSuccess: async () => {
      setPassword("");
      await refresh();
      toast.success("Đã thêm email và mật khẩu");
    },
  });
  const logout = useMutation({
    mutationFn: () => accountApi("/api/auth/logout", "POST", {}),
    onSuccess: async () => {
      await refresh();
      toast("Đã đăng xuất");
      router.push("/");
    },
  });
  return (
    <Card
      title="Hồ sơ"
      actions={
        <Button size="sm" variant="tertiary" isPending={logout.isPending} onPress={() => logout.mutate()}>
          Đăng xuất
        </Button>
      }
    >
      <Facts
        rows={[
          ["Email", u.email ? `${u.email}${u.emailVerified ? "" : " (chưa xác minh)"}` : "Chưa có"],
          ["Phiên này", me.session.method === "siwe" ? "Đăng nhập bằng ví" : "Đăng nhập bằng email"],
          ["Tạo lúc", formatTime(u.createdAt)],
        ]}
      />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="min-w-48 flex-1">
          <TextInput label="Tên hiển thị" value={name} onChange={setName} maxLength={60} />
        </div>
        <Button
          type="submit"
          variant="tertiary"
          isPending={save.isPending}
          isDisabled={name === (u.displayName ?? "")}
        >
          Lưu
        </Button>
      </form>
      {u.hasPassword ? null : (
        <Expand label="Thêm cách đăng nhập bằng email">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              addPassword.mutate();
            }}
          >
            <TextField type="email" autoComplete="email" isRequired value={email} onChange={setEmail}>
              <Label>Email</Label>
              <Input variant="secondary" />
            </TextField>
            <TextField
              type="password"
              autoComplete="new-password"
              isRequired
              minLength={10}
              value={password}
              onChange={setPassword}
            >
              <Label>Mật khẩu (ít nhất 10 ký tự)</Label>
              <Input variant="secondary" />
            </TextField>
            {addPassword.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorOf(addPassword.error)}
              </p>
            ) : null}
            <Button type="submit" variant="tertiary" className="self-start" isPending={addPassword.isPending}>
              Thêm email và mật khẩu
            </Button>
          </form>
        </Expand>
      )}
    </Card>
  );
}
