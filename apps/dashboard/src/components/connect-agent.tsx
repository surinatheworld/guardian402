"use client";
// Connect the owner's AI agent: the API key (shown once), and the MCP server config to paste into the agent's
// client. The agent then has four tools (get_rules, check_payment, pay, get_transaction); `pay` asks the
// Guardian and lets the vault execute, or sends nothing (apps/guardian-mcp/src/agent-tools.ts).
import { Check, Copy, TriangleExclamation } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Tabs } from "@heroui/react/tabs";
import { toast } from "@heroui/react/toast";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Notice } from "./ui";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="tertiary"
      onPress={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(`Đã chép ${label.toLowerCase()}`);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.danger("Trình duyệt không cho chép. Bôi đen rồi chép bằng tay.");
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Đã chép" : label}
    </Button>
  );
}

export function CodeBlock({ code, copyLabel = "Chép" }: { code: string; copyLabel?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-80 overflow-auto rounded-xl bg-surface-secondary p-4 font-mono text-xs leading-relaxed whitespace-pre">
        {code}
      </pre>
      <div>
        <CopyButton value={code} label={copyLabel} />
      </div>
    </div>
  );
}

/** A new key, shown in full once: the server keeps only its hash. */
export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft/40 p-4">
      <div className="flex items-start gap-2 text-sm">
        <TriangleExclamation aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <p>
          <span className="font-semibold">Chép khoá API ngay.</span> Khoá chỉ hiện một lần; mất thì tạo khoá
          mới ở trang Agent.
        </p>
      </div>
      <code className="rounded-lg bg-surface px-3 py-2 font-mono text-sm break-all">{apiKey}</code>
      <div>
        <CopyButton value={apiKey} label="Chép khoá" />
      </div>
    </div>
  );
}

const useOrigin = () =>
  useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

/** MCP config for the agent's client. Secrets are filled in only when this page has them right now. */
export function McpSetup({ apiKey, agentPk }: { apiKey?: string | null; agentPk?: string | null }) {
  const origin = useOrigin();
  const info = useQuery({
    queryKey: ["setup-info"],
    queryFn: async () => (await (await fetch("/api/setup-info")).json()) as { repoRoot: string | null },
    staleTime: Infinity,
  });
  const root = info.data?.repoRoot ?? "<thư mục guardian402>";
  const env = {
    GUARDIAN_API_URL: `${origin}/api/agent/v1`,
    GUARDIAN_API_KEY: apiKey ?? "<khoá API g402_…>",
    AGENT_PK: agentPk ?? "<khoá riêng ví agent 0x…>",
  };
  const claudeCode = [
    "claude mcp add guardian402 \\",
    ...Object.entries(env).map(([k, v]) => `  --env ${k}=${v} \\`),
    `  -- pnpm --silent --dir ${root} mcp:agent`,
  ].join("\n");
  const desktop = JSON.stringify(
    {
      mcpServers: {
        guardian402: {
          command: "pnpm",
          args: ["--silent", "--dir", root, "mcp:agent"],
          env,
        },
      },
    },
    null,
    2,
  );
  const rest = `curl -H "Authorization: Bearer ${env.GUARDIAN_API_KEY}" \\\n  ${env.GUARDIAN_API_URL}/me`;
  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultSelectedKey="code">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Agent của bạn chạy bằng">
            <Tabs.Tab id="code">
              Claude Code
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="desktop">
              Claude Desktop
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="rest">
              API (REST)
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="code" className="flex flex-col gap-2 px-0 pt-4 pb-0">
          <p className="text-sm text-muted">Chạy lệnh này trong terminal, trên máy chạy agent.</p>
          <CodeBlock code={claudeCode} copyLabel="Chép lệnh" />
        </Tabs.Panel>
        <Tabs.Panel id="desktop" className="flex flex-col gap-2 px-0 pt-4 pb-0">
          <p className="text-sm text-muted">
            Dán vào <code className="font-mono text-xs">claude_desktop_config.json</code> (Settings →
            Developer → Edit Config), rồi mở lại Claude Desktop.
          </p>
          <CodeBlock code={desktop} copyLabel="Chép cấu hình" />
        </Tabs.Panel>
        <Tabs.Panel id="rest" className="flex flex-col gap-2 px-0 pt-4 pb-0">
          <p className="text-sm text-muted">
            Agent không dùng MCP thì gọi thẳng API: <code className="font-mono text-xs">GET /me</code> đọc quy
            tắc, <code className="font-mono text-xs">POST /cosign</code> xin duyệt (trả phí x402), rồi agent
            tự gửi <code className="font-mono text-xs">executeBatch</code> vào két.
          </p>
          <CodeBlock code={rest} copyLabel="Chép lệnh" />
        </Tabs.Panel>
      </Tabs>
      {!agentPk ? (
        <Notice title="Khoá ví agent do bạn tự điền">
          Thay <code className="font-mono text-xs">AGENT_PK</code> bằng khoá riêng của ví agent. Khoá chỉ nằm
          trên máy chạy agent; dashboard không bao giờ nhận nó.
        </Notice>
      ) : null}
      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Agent sẽ có 4 công cụ</span>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            ["get_rules", "Đọc quy tắc và hạn mức còn lại. Miễn phí."],
            ["pay", "Trả tiền: Guardian duyệt rồi két chi, hoặc không gửi gì. 0,01 USDC."],
            ["check_payment", "Kiểm tra trước một khoản chi, không gửi. 0,005 USDC."],
            ["get_transaction", "Xem kết quả một giao dịch. Miễn phí."],
          ].map(([name, text]) => (
            <li key={name} className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
              <code className="font-mono text-xs font-medium">{name}</code>
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
