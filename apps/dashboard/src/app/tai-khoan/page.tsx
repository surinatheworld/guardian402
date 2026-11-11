"use client";
// Tài khoản: sign in with email + password (web2) or by signing a message with the wallet (SIWE, web3), then
// manage the profile, linked wallets and linked AgentVaults. The account database is off-chain and never holds
// keys; balances, policy and ownership are always read from the chain.
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { AddressLink, Card, Empty, ErrorBox, Facts, Loading, PageHeader } from "@/components/ui";
import { WalletButton } from "@/components/shell";
import { Field, INPUT, errorOf } from "@/components/form";
import {
  accountApi,
  EVENT_LABEL,
  signInWithWallet,
  useMe,
  useRefreshMe,
  type MeResponse,
} from "@/lib/account";
import { deployment } from "@/lib/config";
import { formatTime } from "@/lib/format";

export default function AccountPage() {
  const me = useMe();
  return (
    <>
      <PageHeader
        title="Tài khoản"
        lead="Đăng nhập bằng email hoặc bằng ví. Tài khoản chỉ lưu thông tin ngoài chuỗi: email, ví bạn đã ký xác nhận và vault bạn quản lý. Không bao giờ lưu khoá riêng hay cụm từ khôi phục."
      />
      {me.isPending ? (
        <Loading />
      ) : me.isError ? (
        <ErrorBox
          title="Không đọc được tài khoản"
          detail={errorOf(me.error)}
          onRetry={() => void me.refetch()}
        />
      ) : me.data ? (
        <SignedIn me={me.data} />
      ) : (
        <SignedOut />
      )}
    </>
  );
}

// ------------------------------------------------------------------ signed out

function SignedOut() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <PasswordForm />
      <WalletSignIn />
    </div>
  );
}

function PasswordForm() {
  const refresh = useRefreshMe();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      mode === "login"
        ? accountApi("/api/auth/login", "POST", { email, password })
        : accountApi("/api/auth/register", "POST", { email, password, displayName }),
    onSuccess: () => {
      setPassword("");
      void refresh();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  return (
    <Card title={mode === "login" ? "Đăng nhập bằng email" : "Tạo tài khoản bằng email"}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field id="email" label="Email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </Field>
        {mode === "register" ? (
          <Field id="display-name" label="Tên hiển thị (không bắt buộc)">
            <input
              id="display-name"
              autoComplete="nickname"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={INPUT}
            />
          </Field>
        ) : null}
        <Field id="password" label={mode === "login" ? "Mật khẩu" : "Mật khẩu (ít nhất 10 ký tự)"}>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </Field>
        {submit.isError ? (
          <p role="alert" className="text-sm text-high">
            {errorOf(submit.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" isDisabled={submit.isPending}>
            {submit.isPending ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onPress={() => {
              submit.reset();
              setMode(mode === "login" ? "register" : "login");
            }}
          >
            {mode === "login" ? "Chưa có tài khoản? Tạo mới" : "Đã có tài khoản? Đăng nhập"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WalletSignIn() {
  const refresh = useRefreshMe();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const run = useMutation({
    mutationFn: () => {
      if (!address) throw new Error("Hãy kết nối ví trước.");
      return signInWithWallet(address, signMessageAsync);
    },
    onSuccess: () => void refresh(),
  });
  return (
    <Card title="Đăng nhập bằng ví">
      <p className="text-sm text-muted">
        Ví ký một thông điệp đăng nhập (chuẩn Sign-In with Ethereum, EIP-4361). Việc ký không tốn phí, không
        gửi giao dịch và không cho dashboard quyền chuyển tiền. Ví chưa có tài khoản sẽ được tạo tài khoản
        mới.
      </p>
      <WalletButton />
      {run.isError ? (
        <p role="alert" className="text-sm text-high">
          {errorOf(run.error)}
        </p>
      ) : null}
      <Button
        variant="primary"
        type="button"
        isDisabled={!isConnected || run.isPending}
        onPress={() => run.mutate()}
        className="self-start"
      >
        {run.isPending ? "Đang chờ chữ ký trong ví…" : "Ký để đăng nhập"}
      </Button>
    </Card>
  );
}

// ------------------------------------------------------------------ signed in

function SignedIn({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const logout = useMutation({
    mutationFn: () => accountApi("/api/auth/logout", "POST", {}),
    onSuccess: () => void refresh(),
  });
  const u = me.user;
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Hồ sơ"
        actions={
          <Button
            variant="secondary"
            type="button"
            isDisabled={logout.isPending}
            onPress={() => logout.mutate()}
          >
            Đăng xuất
          </Button>
        }
      >
        <Facts
          rows={[
            [
              "Email",
              u.email
                ? `${u.email}${u.emailVerified ? "" : " (chưa xác minh)"}`
                : "Chưa có (tài khoản chỉ dùng ví)",
            ],
            ["Tên hiển thị", u.displayName ?? "Chưa đặt"],
            [
              "Phiên này đăng nhập bằng",
              me.session.method === "siwe" ? "Chữ ký ví (SIWE)" : "Email và mật khẩu",
            ],
            ["Tạo lúc", formatTime(u.createdAt)],
            ["Đăng nhập gần nhất", u.lastLoginAt ? formatTime(u.lastLoginAt) : "—"],
          ]}
        />
        <ProfileForm current={u.displayName ?? ""} />
        {u.hasPassword ? null : <AddPassword />}
      </Card>
      <Wallets me={me} />
      <Vaults me={me} />
      <Card title="Hoạt động bảo mật">
        {me.events.length === 0 ? (
          <Empty>Chưa có sự kiện nào.</Empty>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {me.events.map((e, i) => (
              <li key={`${e.createdAt}-${i}`} className="flex flex-wrap justify-between gap-2">
                <span>
                  {EVENT_LABEL[e.event] ?? e.event}
                  {typeof e.detail?.address === "string" ? (
                    <span className="ml-2 font-mono text-xs text-muted">{e.detail.address}</span>
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

function ProfileForm({ current }: { current: string }) {
  const refresh = useRefreshMe();
  const [name, setName] = useState(current);
  const save = useMutation({
    mutationFn: () => accountApi("/api/account/profile", "PATCH", { displayName: name }),
    onSuccess: () => void refresh(),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
    >
      <Field id="profile-name" label="Đổi tên hiển thị">
        <input
          id="profile-name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
        />
      </Field>
      <Button variant="secondary" type="submit" isDisabled={save.isPending || name === current}>
        Lưu
      </Button>
      {save.isError ? (
        <p role="alert" className="w-full text-sm text-high">
          {errorOf(save.error)}
        </p>
      ) : null}
    </form>
  );
}

function AddPassword() {
  const refresh = useRefreshMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const add = useMutation({
    mutationFn: () => accountApi("/api/account/password", "POST", { email, password }),
    onSuccess: () => {
      setPassword("");
      void refresh();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <h3 className="text-sm font-semibold">Thêm email và mật khẩu</h3>
      <p className="text-sm text-muted">
        Tài khoản này chỉ đăng nhập được bằng ví. Thêm email và mật khẩu để có cách đăng nhập dự phòng.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="add-email" label="Email">
          <input
            id="add-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field id="add-password" label="Mật khẩu (ít nhất 10 ký tự)">
          <input
            id="add-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>
      {add.isError ? (
        <p role="alert" className="text-sm text-high">
          {errorOf(add.error)}
        </p>
      ) : null}
      <Button variant="secondary" type="submit" isDisabled={add.isPending} className="self-start">
        Thêm cách đăng nhập
      </Button>
    </form>
  );
}

function Wallets({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [confirm, setConfirm] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: () => {
      if (!address) throw new Error("Hãy kết nối ví trước.");
      return signInWithWallet(address, signMessageAsync);
    },
    onSuccess: () => void refresh(),
  });
  const unlink = useMutation({
    mutationFn: (a: string) => accountApi(`/api/account/wallets/${a}`, "DELETE"),
    onSuccess: () => {
      setConfirm(null);
      void refresh();
    },
  });
  const connectedLinked = me.wallets.some((w) => w.address.toLowerCase() === address?.toLowerCase());
  return (
    <Card title="Ví đã liên kết">
      <p className="text-sm text-muted">
        Mỗi ví được thêm bằng một chữ ký chứng minh bạn giữ ví đó. Một ví chỉ thuộc một tài khoản.
      </p>
      {me.wallets.length === 0 ? (
        <Empty>Chưa có ví nào.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {me.wallets.map((w) => (
            <li key={w.address} className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <AddressLink address={w.address} />
                {w.isPrimary ? (
                  <Chip variant="secondary" size="sm">
                    Ví chính
                  </Chip>
                ) : null}
                <span className="text-xs text-muted">xác minh {formatTime(w.verifiedAt)}</span>
              </div>
              {confirm === w.address ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    Gỡ ví này? Các vault liên kết qua ví này cũng bị gỡ khỏi tài khoản (không đổi gì trên
                    chain).
                  </span>
                  <Button variant="danger-soft" type="button" onPress={() => unlink.mutate(w.address)}>
                    Gỡ ví
                  </Button>
                  <Button variant="secondary" type="button" onPress={() => setConfirm(null)}>
                    Huỷ
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  type="button"
                  onPress={() => {
                    unlink.reset();
                    setConfirm(w.address);
                  }}
                  className="self-start"
                >
                  Gỡ
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {unlink.isError ? (
        <p role="alert" className="text-sm text-high">
          {errorOf(unlink.error)}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <WalletButton />
        {link.isError ? (
          <p role="alert" className="text-sm text-high">
            {errorOf(link.error)}
          </p>
        ) : null}
        <Button
          variant="primary"
          type="button"
          isDisabled={!isConnected || connectedLinked || link.isPending}
          onPress={() => link.mutate()}
          className="self-start"
        >
          {connectedLinked
            ? "Ví đang kết nối đã liên kết"
            : link.isPending
              ? "Đang chờ chữ ký trong ví…"
              : "Ký để liên kết ví đang kết nối"}
        </Button>
      </div>
    </Card>
  );
}

function Vaults({ me }: { me: MeResponse }) {
  const refresh = useRefreshMe();
  const [vault, setVault] = useState<string>(deployment.vault);
  const [label, setLabel] = useState("");
  const link = useMutation({
    mutationFn: () => accountApi("/api/account/vaults", "POST", { address: vault.trim(), label }),
    onSuccess: () => {
      setLabel("");
      void refresh();
    },
  });
  const unlink = useMutation({
    mutationFn: (a: string) => accountApi(`/api/account/vaults/${a}`, "DELETE"),
    onSuccess: () => void refresh(),
  });
  return (
    <Card title="Vault đã liên kết">
      <p className="text-sm text-muted">
        Chỉ liên kết được vault mà hàm owner() trên chain trả về một ví của bạn. Số dư, hạn mức và agent vẫn
        luôn được đọc trực tiếp từ chain.
      </p>
      {me.vaults.length === 0 ? (
        <Empty>Chưa liên kết vault nào.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {me.vaults.map((v) => (
            <li key={v.address} className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{v.label ?? "AgentVault"}</span>
                <AddressLink address={v.address} />
              </div>
              <p className="text-xs text-muted">
                Chủ trên chain: <span className="font-mono">{v.ownerWallet}</span> · xác minh{" "}
                {formatTime(v.verifiedAt)}
              </p>
              <Button
                variant="secondary"
                type="button"
                isDisabled={unlink.isPending}
                onPress={() => unlink.mutate(v.address)}
                className="self-start"
              >
                Gỡ khỏi tài khoản
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate();
        }}
        className="flex flex-col gap-3 border-t border-line pt-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <Field id="vault-address" label="Địa chỉ AgentVault">
            <input
              id="vault-address"
              required
              spellCheck={false}
              value={vault}
              onChange={(e) => setVault(e.target.value)}
              className={`${INPUT} font-mono`}
            />
          </Field>
          <Field id="vault-label" label="Tên gợi nhớ (không bắt buộc)">
            <input
              id="vault-label"
              maxLength={40}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        {link.isError ? (
          <p role="alert" className="text-sm text-high">
            {errorOf(link.error)}
          </p>
        ) : null}
        {unlink.isError ? (
          <p role="alert" className="text-sm text-high">
            {errorOf(unlink.error)}
          </p>
        ) : null}
        <Button variant="primary" type="submit" isDisabled={link.isPending} className="self-start">
          {link.isPending ? "Đang đọc owner() trên chain…" : "Liên kết vault"}
        </Button>
      </form>
    </Card>
  );
}
