"use client";
// Sign in: with the wallet (Sign-In with Ethereum: one free signature, no transaction) or with email and
// password. Used by /dang-nhap. The account database never holds a key.
import { ArrowUpRightFromSquare, Wallet } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { Link } from "@heroui/react/link";
import { TextField } from "@heroui/react/textfield";
import { toast } from "@heroui/react/toast";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { accountApi, signInWithWallet, useRefreshMe } from "@/lib/account";
import { NETWORK } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { walletOptions } from "@/lib/wallets";
import { errorOf } from "./form";
import { Notice } from "./ui";

/** After signing in: back to the page that sent the visitor here (`?quay-lai=/agent`), else home. */
function useAfterSignIn() {
  const router = useRouter();
  const refresh = useRefreshMe();
  return async (message: string) => {
    await refresh();
    toast.success(message);
    const to = new URLSearchParams(window.location.search).get("quay-lai");
    router.replace(to && to.startsWith("/") && !to.startsWith("//") ? to : "/");
  };
}

const rejected = (e: unknown) =>
  /user rejected|denied|rejected the request/i.test(errorOf(e))
    ? "Bạn đã từ chối trong ví. Chưa có gì thay đổi."
    : errorOf(e).split("\n")[0];

/** One button: connect the wallet if needed, then sign the sign-in message. */
export function WalletSignIn() {
  const done = useAfterSignIn();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const [phase, setPhase] = useState<"idle" | "connect" | "sign">("idle");
  // Core first when installed; the visitor can pick another installed wallet.
  const options = walletOptions(connectors);
  const [pick, setPick] = useState<string | null>(null);
  const chosen = options.find((o) => o.uid === pick) ?? options[0];
  const run = useMutation({
    mutationFn: async () => {
      let who = address;
      if (!isConnected || !who) {
        const connector = chosen;
        if (!connector) throw new Error("Trình duyệt chưa có ví. Cài Core hoặc MetaMask rồi tải lại trang.");
        setPhase("connect");
        who = (await connectAsync({ connector, chainId: avalancheFuji.id })).accounts[0];
      }
      if (!who) throw new Error("Ví không trả về địa chỉ nào.");
      setPhase("sign");
      return signInWithWallet(who, signMessageAsync);
    },
    onSettled: () => setPhase("idle"),
    onSuccess: (r) => done(r.outcome === "created" ? "Đã tạo tài khoản bằng ví" : "Đã đăng nhập"),
  });
  if (NETWORK === "local")
    return (
      <Notice title="Bản chạy trên fork không kết nối ví">
        Đăng nhập bằng email, hoặc mở dashboard ở mạng Fuji để dùng ví.
      </Notice>
    );
  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" size="lg" fullWidth isPending={run.isPending} onPress={() => run.mutate()}>
        <Wallet aria-hidden="true" />
        {phase === "connect"
          ? "Đang mở ví…"
          : phase === "sign"
            ? "Ký trong ví để đăng nhập…"
            : isConnected && address
              ? `Đăng nhập bằng ${shortHex(address)}`
              : chosen && chosen.id !== "injected"
                ? `Đăng nhập bằng ${chosen.name}`
                : "Đăng nhập bằng ví"}
      </Button>
      {!isConnected && options.length > 1 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          Dùng ví khác:
          {options
            .filter((o) => o.uid !== chosen?.uid)
            .map((o) => (
              <Button key={o.uid} size="sm" variant="ghost" onPress={() => setPick(o.uid)}>
                {o.name}
              </Button>
            ))}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        Ví ký một thông điệp miễn phí để đăng nhập. Nếu chưa có tài khoản, tài khoản sẽ được tạo.
      </p>
      {run.isError ? (
        <p role="alert" className="text-sm text-danger">
          {rejected(run.error)}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        Chưa có ví?{" "}
        <Link href="https://core.app" target="_blank" rel="noreferrer" className="text-sm">
          Cài Core, ví của Avalanche
          <ArrowUpRightFromSquare aria-hidden="true" className="ml-1 inline size-3" />
        </Link>
      </p>
    </div>
  );
}

// The browser words its own validation messages in its own language (English on most machines): the form says
// them in Vietnamese instead, matching what the API answers.
export function PasswordSignIn() {
  const done = useAfterSignIn();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      accountApi(mode === "login" ? "/api/auth/login" : "/api/auth/register", "POST", { email, password }),
    onSuccess: () => {
      setPassword("");
      return done(mode === "login" ? "Đã đăng nhập" : "Đã tạo tài khoản");
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <TextField type="email" name="email" autoComplete="email" isRequired value={email} onChange={setEmail}>
        <Label>Email</Label>
        <Input variant="secondary" placeholder="ban@vidu.com" />
        <FieldError>
          {(v) => (v.validationDetails.valueMissing ? "Hãy nhập email." : "Email không hợp lệ.")}
        </FieldError>
      </TextField>
      <TextField
        type="password"
        name="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        isRequired
        {...(mode === "register" ? { minLength: 10 } : {})}
        value={password}
        onChange={setPassword}
      >
        <Label>Mật khẩu</Label>
        <Input variant="secondary" />
        {mode === "register" ? <Description>Ít nhất 10 ký tự.</Description> : null}
        <FieldError>
          {(v) =>
            v.validationDetails.valueMissing ? "Hãy nhập mật khẩu." : "Mật khẩu cần ít nhất 10 ký tự."
          }
        </FieldError>
      </TextField>
      {submit.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorOf(submit.error)}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" fullWidth isPending={submit.isPending}>
        {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-1 align-baseline font-medium text-accent"
          onPress={() => {
            submit.reset();
            setMode(mode === "login" ? "register" : "login");
          }}
        >
          {mode === "login" ? "Tạo tài khoản" : "Đăng nhập"}
        </Button>
      </p>
      {mode === "register" ? (
        <p className="text-xs text-muted">
          Để tạo két bạn vẫn cần một ví (Core hoặc MetaMask): ví là chủ két và ký mọi thay đổi.
        </p>
      ) : null}
    </form>
  );
}
