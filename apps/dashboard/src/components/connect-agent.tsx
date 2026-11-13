"use client";
// Connect the owner's AI agent, whatever runs it: the three values the agent needs (API URL, API key, the agent
// wallet's key), then either the MCP server config (any MCP client: the `mcpServers` format) or the REST steps.
// With MCP the agent gets four tools (get_rules, check_payment, pay, get_transaction); `pay` asks the Guardian and
// lets the vault execute, or sends nothing (apps/guardian-mcp/src/agent-tools.ts).
import { ArrowUpRightFromSquare, Check, Copy, TriangleExclamation } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Tabs } from "@heroui/react/tabs";
import { toast } from "@heroui/react/toast";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Expand } from "./ui";

const API_DOCS = "https://github.com/surinatheworld/guardian402/blob/main/docs/API.md#agent-api-apiagentv1";

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
    <div className="flex min-w-0 flex-col gap-2">
      <pre className="max-h-[28rem] max-w-full overflow-auto rounded-xl bg-surface-secondary p-4 font-mono text-xs leading-relaxed whitespace-pre">
        {code}
      </pre>
      <div>
        <CopyButton value={code} label={copyLabel} />
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

const short = (v: string) => (v.length > 16 ? `${v.slice(0, 10)}…${v.slice(-4)}` : v);

/** One value the agent needs: what it is, the value (or how to get it), and a copy button when there is one. */
function ConnectionRow({
  label,
  hint,
  value,
  display,
  copyLabel,
  empty,
  warning,
}: {
  label: string;
  hint: ReactNode;
  value?: string | null | undefined;
  display?: string | undefined;
  copyLabel: string;
  empty?: ReactNode;
  /** Shown with the value, e.g. a secret this page will not show again. */
  warning?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
        {value ? (
          <code className="mt-1 font-mono text-xs break-all text-foreground">{display ?? value}</code>
        ) : (
          <span className="mt-1 text-xs text-foreground">{empty}</span>
        )}
        {value && warning ? (
          <span className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warning">
            <TriangleExclamation aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {warning}
          </span>
        ) : null}
      </div>
      {value ? (
        <div className="shrink-0">
          <CopyButton value={value} label={copyLabel} />
        </div>
      ) : null}
    </div>
  );
}

const TOOLS: [string, string][] = [
  ["get_rules", "Đọc quy tắc và hạn mức còn lại. Miễn phí."],
  ["pay", "Trả tiền: Guardian duyệt rồi két chi, hoặc không gửi gì. 0,01 USDC."],
  ["check_payment", "Kiểm tra trước một khoản chi, không gửi. 0,005 USDC."],
  ["get_transaction", "Xem kết quả một giao dịch. Miễn phí."],
];

const REST_STEPS: [string, string][] = [
  ["GET /me", "Đọc quy tắc của két: người nhận, hạn mức còn lại, và hướng dẫn viết sẵn cho AI."],
  [
    "POST /cosign",
    "Gửi khoản chi dự định để Guardian chấm rủi ro. Trả phí 0,01 USDC qua x402 rồi nhận phê duyệt đã ký.",
  ],
  [
    "executeBatch",
    "Ví agent tự gửi khoản chi kèm phê duyệt vào két trên Avalanche. Két kiểm lại rồi mới chi.",
  ],
  ["GET /transactions/:hash", "Xem két đã chi hay từ chối."],
];

/**
 * How to connect an agent: the values it needs, then MCP (any client) or the REST API. Secrets are filled in
 * only when this page has them right now (a fresh API key, an agent key generated in this browser).
 */
export function McpSetup({
  apiKey,
  agentPk,
  newKeyHint = "tạo khoá mới ở trang Agent",
}: {
  apiKey?: string | null;
  agentPk?: string | null;
  /** How to get another API key from where this is shown. */
  newKeyHint?: string;
}) {
  const origin = useOrigin();
  const info = useQuery({
    queryKey: ["setup-info"],
    queryFn: async () => (await (await fetch("/api/setup-info")).json()) as { repoRoot: string | null },
    staleTime: Infinity,
  });
  const apiUrl = `${origin}/api/agent/v1`;
  const root = info.data?.repoRoot ?? "<thư mục guardian402>";
  const env = {
    GUARDIAN_API_URL: apiUrl,
    GUARDIAN_API_KEY: apiKey ?? "<khoá API g402_…>",
    AGENT_PK: agentPk ?? "<khoá riêng ví agent 0x…>",
  };
  const mcpConfig = JSON.stringify(
    { mcpServers: { guardian402: { command: "pnpm", args: ["--silent", "--dir", root, "mcp:agent"], env } } },
    null,
    2,
  );
  const cliExample = [
    "claude mcp add guardian402 \\",
    ...Object.entries(env).map(([k, v]) => `  --env ${k}=${v} \\`),
    `  -- pnpm --silent --dir ${root} mcp:agent`,
  ].join("\n");
  const curl = `curl -H "Authorization: Bearer ${env.GUARDIAN_API_KEY}" \\\n  ${apiUrl}/me`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="ket-noi-thong-tin" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="ket-noi-thong-tin" className="text-heading">
            Agent cần 3 thông tin
          </h3>
          <p className="text-sm text-muted">
            Dùng được với mọi agent: ứng dụng có MCP, hoặc code của bạn gọi thẳng API.
          </p>
        </div>
        <div className="flex flex-col divide-y divide-separator rounded-xl bg-surface-secondary p-4">
          <ConnectionRow
            label="Địa chỉ API"
            hint="Nơi agent đọc quy tắc và xin Guardian duyệt."
            value={origin ? apiUrl : null}
            copyLabel="Chép địa chỉ"
            empty="Đang tải…"
          />
          <ConnectionRow
            label="Khoá API"
            hint="Cho biết agent thuộc két nào. Không rút được tiền, không đổi được quy tắc."
            value={apiKey}
            copyLabel="Chép khoá"
            warning={`Chép ngay: khoá chỉ hiện một lần. Mất thì ${newKeyHint}.`}
            empty={`Khoá chỉ hiện một lần lúc tạo nên không xem lại được. Mất thì ${newKeyHint}.`}
          />
          <ConnectionRow
            label="Khoá riêng ví agent"
            hint="Agent dùng để tự ký giao dịch. Chỉ nằm trên máy chạy agent; dashboard không bao giờ nhận."
            value={agentPk}
            display={agentPk ? short(agentPk) : undefined}
            copyLabel="Chép khoá ví"
            warning="Chép và cất kỹ: dashboard không lưu khoá này."
            empty="Bạn tự điền trên máy chạy agent."
          />
        </div>
      </section>

      <Tabs defaultSelectedKey="mcp" className="min-w-0">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Agent kết nối bằng">
            <Tabs.Tab id="mcp">
              MCP
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="rest">
              REST API
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="mcp" className="flex flex-col gap-4 px-0 pt-4 pb-0">
          <p className="text-sm text-muted">
            Cho ứng dụng agent hỗ trợ MCP, với bất kỳ mô hình AI nào. Thêm máy chủ này vào phần cấu hình MCP
            của ứng dụng (định dạng <code className="font-mono text-xs">mcpServers</code>), rồi mở lại ứng
            dụng.
          </p>
          <CodeBlock code={mcpConfig} copyLabel="Chép cấu hình" />
          <p className="text-xs text-muted">
            Máy chạy agent cần Node.js, pnpm và mã nguồn Guardian402 (chạy{" "}
            <code className="font-mono">pnpm install</code> một lần). Trên Windows, nếu ứng dụng báo không
            chạy được <code className="font-mono">pnpm</code>, đổi thành{" "}
            <code className="font-mono">pnpm.cmd</code>.
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Agent sẽ có 4 công cụ</span>
            <ul className="grid gap-2 sm:grid-cols-2">
              {TOOLS.map(([name, text]) => (
                <li key={name} className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
                  <code className="font-mono text-xs font-medium">{name}</code>
                  <span className="text-muted">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <Expand label="Ví dụ: thêm bằng một lệnh (Claude Code)">
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-sm text-muted">Chạy trong terminal, trên máy chạy agent.</p>
              <CodeBlock code={cliExample} copyLabel="Chép lệnh" />
            </div>
          </Expand>
        </Tabs.Panel>

        <Tabs.Panel id="rest" className="flex flex-col gap-4 px-0 pt-4 pb-0">
          <p className="text-sm text-muted">
            Cho code của bạn, có hay không có AI. Mọi yêu cầu gửi kèm{" "}
            <code className="font-mono text-xs">Authorization: Bearer &lt;khoá API&gt;</code>.
          </p>
          <ol className="flex flex-col gap-2 text-sm">
            {REST_STEPS.map(([call, text], i) => (
              <li key={call} className="flex gap-3 rounded-xl bg-surface-secondary p-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <code className="font-mono text-xs font-medium">{call}</code>
                  <span className="text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Thử ngay bước 1:</p>
            <CodeBlock code={curl} copyLabel="Chép lệnh" />
          </div>
          <a
            href={API_DOCS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            Tài liệu Agent API đầy đủ
            <ArrowUpRightFromSquare aria-hidden="true" className="size-3.5" />
          </a>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
