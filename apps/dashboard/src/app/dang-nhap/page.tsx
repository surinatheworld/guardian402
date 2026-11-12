"use client";
// Đăng nhập: the door to the app. Left, what the product does in three steps (a newcomer learns the model before
// the first click); right, sign in with the wallet or email, or look at the demo vault without an account.
import { Cpu, Eye, ShieldCheck, Vault } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import { Separator } from "@heroui/react/separator";
import { Tabs } from "@heroui/react/tabs";
import { useRouter } from "next/navigation";
import { PasswordSignIn, WalletSignIn } from "@/components/sign-in";
import { NETWORK } from "@/lib/config";
import { useSelectedVault } from "@/lib/vault-context";

const STEPS = [
  {
    icon: Vault,
    title: "Bạn tạo két và đặt quy tắc",
    text: "Tiền nằm trong két của bạn trên Avalanche. Bạn chọn người nhận, hạn mức ngày, mỗi giao dịch và tổng.",
  },
  {
    icon: Cpu,
    title: "Agent nhận khoá API",
    text: "Gắn khoá vào agent AI của bạn qua MCP. Khoá không rút được tiền và không đổi được quy tắc.",
  },
  {
    icon: ShieldCheck,
    title: "Mỗi lần chi đều được kiểm tra",
    text: "Guardian chạy thử giao dịch và chấm rủi ro trước. Két chỉ chi khi mọi quy tắc đều đạt.",
  },
];

export default function SignInPage() {
  const router = useRouter();
  const { setViewingDemo } = useSelectedVault();
  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 py-8 lg:grid-cols-[1fr_420px] lg:gap-16">
      <section aria-labelledby="gioi-thieu" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 id="gioi-thieu" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Cho AI agent tiêu tiền,
            <br />
            trong giới hạn bạn đặt.
          </h1>
          <p className="max-w-md text-base text-muted">
            Guardian402 là két và tường lửa giao dịch cho ví của AI agent, trên mạng Avalanche.
          </p>
        </div>
        <ol className="flex flex-col gap-5">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-foreground shadow-surface">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  <span className="text-muted tabular-nums">{i + 1}.</span> {title}
                </span>
                <span className="max-w-md text-sm text-muted">{text}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Card className="w-full sm:p-6">
        <Card.Header className="gap-1">
          <Card.Title className="text-heading">Đăng nhập</Card.Title>
          <Card.Description>Chưa có tài khoản thì lần đăng nhập đầu tiên sẽ tạo luôn.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          <Tabs defaultSelectedKey={NETWORK === "local" ? "email" : "wallet"}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Cách đăng nhập" className="w-full">
                <Tabs.Tab id="wallet">
                  Bằng ví
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="email">
                  Bằng email
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="wallet" className="px-0 pt-5 pb-0">
              <WalletSignIn />
            </Tabs.Panel>
            <Tabs.Panel id="email" className="px-0 pt-5 pb-0">
              <PasswordSignIn />
            </Tabs.Panel>
          </Tabs>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted">hoặc</span>
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              variant="tertiary"
              fullWidth
              onPress={() => {
                setViewingDemo(true);
                router.push("/");
              }}
            >
              <Eye aria-hidden="true" />
              Xem két demo
            </Button>
            <p className="text-center text-xs text-muted">Không cần tài khoản. Chỉ xem, trên mạng thử.</p>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
