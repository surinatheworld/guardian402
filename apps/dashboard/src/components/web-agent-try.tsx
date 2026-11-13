"use client";
// "Try the agent on the web": one button makes the payment the owner's agent would make (Guardian check and
// approval, then the vault executes it), and another shows the vault refusing one over the limit. Nothing to
// install: the agent wallet key stays in this tab (src/lib/web-agent.ts).
import { CircleCheck, CircleXmark, Play } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { useReadContract } from "wagmi";
import { agentVaultAbi } from "@guardian402/shared";
import { AGENT_FEE_AVAX, useBalances } from "@/lib/balances";
import { deployment } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { agentAddressOf, isAgentKey, usdcTransfer, webPay, type WebPayResult } from "@/lib/web-agent";
import { useContacts } from "@/lib/workspace";
import { AgentFeeForm } from "./fund";
import { Notice, TxLink } from "./ui";

const usdc = (raw: bigint) => formatUnits(raw, 6).replace(".", ",");
const asInput = (raw: bigint) => formatUnits(raw, 6);

/** A small amount that the rules let through: half the per-payment cap, at most 1 USDC and the vault balance. */
export function tryAmounts(p: {
  balance: bigint;
  dailyLeft: bigint;
  maxPerTx: bigint;
  budgetLeft: bigint | null;
}) {
  const caps = [1_000_000n, p.balance, p.dailyLeft];
  if (p.maxPerTx > 0n) caps.push(p.maxPerTx / 2n);
  if (p.budgetLeft !== null) caps.push(p.budgetLeft);
  const ok = caps.reduce((a, b) => (b < a ? b : a));
  // The refused payment must fail on a rule, not on the balance: over the per-payment cap when the vault holds
  // enough to pay it, else a small payment to an address that is not an allowed recipient.
  const overCap = p.maxPerTx > 0n ? p.maxPerTx + 1_000_000n : 0n;
  const blocked: { kind: "over-cap"; amount: bigint } | { kind: "stranger"; amount: bigint } =
    overCap > 0n && overCap <= p.balance
      ? { kind: "over-cap", amount: overCap }
      : { kind: "stranger", amount: ok > 0n ? ok : 100_000n };
  return { ok: ok > 0n ? ok : 0n, blocked };
}

/** Not an allowed recipient of any vault: the vault refuses a payment to it. */
export const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";

export function WebAgentTry({ vault, initialKey }: { vault: Address; initialKey?: Hex | null }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState<string>(initialKey ?? "");
  const [running, setRunning] = useState<"ok" | "over" | null>(null);
  const [result, setResult] = useState<WebPayResult | null>(null);

  const policy = useReadContract({
    address: vault,
    abi: agentVaultAbi,
    functionName: "getPolicy",
    query: { refetchInterval: 10_000 },
  });
  const limits = useReadContract({
    address: vault,
    abi: agentVaultAbi,
    functionName: "getLimits",
    query: { refetchInterval: 10_000, retry: false },
  });
  const contacts = useContacts(vault);

  const agentFromKey = agentAddressOf(key);
  const vaultAgent = policy.data?.agent;
  const keyMatches = Boolean(
    agentFromKey && vaultAgent && agentFromKey.toLowerCase() === vaultAgent.toLowerCase(),
  );
  const fees = useBalances(keyMatches ? (agentFromKey ?? undefined) : undefined);
  const lowFees =
    keyMatches &&
    ((fees.avax !== undefined && fees.avax < AGENT_FEE_AVAX / 5n) ||
      (fees.usdc !== undefined && fees.usdc < 20_000n));

  const token = policy.data?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());
  const usdcLimits = limits.data?.find((l) => l.token.toLowerCase() === deployment.usdc.toLowerCase());
  const recipient = contacts.data?.contacts.find((c) => c.allowlisted.recipient);
  const amounts = token
    ? tryAmounts({
        balance: token.balance,
        dailyLeft: token.dailyCap > token.spentToday ? token.dailyCap - token.spentToday : 0n,
        maxPerTx: usdcLimits?.maxPerTx ?? 0n,
        budgetLeft:
          usdcLimits && usdcLimits.budget > 0n
            ? usdcLimits.budget > usdcLimits.spentSinceReset
              ? usdcLimits.budget - usdcLimits.spentSinceReset
              : 0n
            : null,
      })
    : null;

  const ready = keyMatches && Boolean(recipient) && Boolean(amounts) && Boolean(policy.data);
  async function run(kind: "ok" | "over") {
    if (!ready || !recipient || !amounts || !policy.data) return;
    setRunning(kind);
    setResult(null);
    const r = await webPay({
      agentKey: key.trim() as Hex,
      vault,
      calls:
        kind === "ok"
          ? usdcTransfer(recipient.address, asInput(amounts.ok))
          : usdcTransfer(
              amounts.blocked.kind === "stranger" ? STRANGER : recipient.address,
              asInput(amounts.blocked.amount),
            ),
      maxRisk: policy.data.maxAgentRisk,
      paused: policy.data.paused,
      vaultAgent: policy.data.agent,
    });
    setResult(r);
    setRunning(null);
    await queryClient.invalidateQueries();
  }

  return (
    <div className="flex flex-col gap-4">
      {initialKey ? (
        <p className="text-sm text-muted">
          Dùng ví agent vừa tạo ({shortHex(agentFromKey ?? "", 6, 4)}). Khoá chỉ nằm trong tab này.
        </p>
      ) : (
        <TextField value={key} onChange={setKey} className="min-w-0" isInvalid={Boolean(key) && !keyMatches}>
          <Label>Khoá riêng ví agent</Label>
          <Input
            variant="secondary"
            type="password"
            placeholder="0x…"
            spellCheck={false}
            className="font-mono"
          />
          <Description>
            {!key
              ? "Khoá chỉ nằm trong tab này để ký thử; không gửi lên máy chủ."
              : !isAgentKey(key)
                ? "Khoá riêng có dạng 0x và 64 ký tự."
                : keyMatches
                  ? `Đúng ví agent của két (${shortHex(agentFromKey ?? "", 6, 4)}).`
                  : `Đây là ví ${shortHex(agentFromKey ?? "", 6, 4)}, không phải ví agent của két (${shortHex(vaultAgent ?? "", 6, 4)}).`}
          </Description>
        </TextField>
      )}

      {keyMatches && !recipient && contacts.isSuccess ? (
        <Notice status="warning" title="Két chưa có người nhận">
          Thêm người nhận ở trang Quy tắc chi tiêu để agent có chỗ trả tiền.
        </Notice>
      ) : null}
      {token && token.balance === 0n ? (
        <Notice status="warning" title="Két chưa có tiền">
          Nạp USDC vào két trước để agent có tiền chi.
        </Notice>
      ) : null}
      {lowFees && agentFromKey ? (
        <Notice status="warning" title="Ví agent cần phí">
          Mỗi lần trả, ví agent trả phí Guardian (0,01 USDC) và phí mạng (AVAX). Gửi phí cho agent:
          <div className="mt-2">
            <AgentFeeForm agent={agentFromKey} />
          </div>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          isDisabled={!ready || running !== null || !amounts || amounts.ok === 0n}
          isPending={running === "ok"}
          onPress={() => void run("ok")}
        >
          <Play aria-hidden="true" />
          {amounts && amounts.ok > 0n && recipient
            ? `Trả ${usdc(amounts.ok)} USDC cho ${recipient.name}`
            : "Trả thử một khoản nhỏ"}
        </Button>
        <Button
          variant="tertiary"
          isDisabled={!ready || running !== null}
          isPending={running === "over"}
          onPress={() => void run("over")}
        >
          {!amounts
            ? "Thử một khoản bị chặn"
            : amounts.blocked.kind === "over-cap"
              ? `Thử trả ${usdc(amounts.blocked.amount)} USDC (vượt hạn mức mỗi giao dịch)`
              : `Thử trả ${usdc(amounts.blocked.amount)} USDC cho ví lạ (ngoài danh sách)`}
        </Button>
      </div>
      {running ? (
        <p className="text-sm text-muted" aria-live="polite">
          {running === "ok" ? "Đang xin Guardian duyệt rồi gửi vào két…" : "Đang xin Guardian duyệt…"} Mất vài
          giây.
        </p>
      ) : null}
      {result ? <ResultView r={result} /> : null}
    </div>
  );
}

function resultTitle(r: Exclude<WebPayResult, { outcome: "error" }>) {
  if (r.outcome === "paid") return "Két đã chi";
  if (r.outcome === "reverted") return "Giao dịch bị két từ chối trên chain";
  if (r.by === "guardian") return "Guardian không duyệt, không gửi gì";
  if (r.by === "vault") return "Két sẽ từ chối, không gửi gì";
  return "Không gửi";
}

function ResultView({ r }: { r: WebPayResult }) {
  if (r.outcome === "error")
    return (
      <Notice status="danger" title="Chưa chạy được">
        {r.message}
      </Notice>
    );
  const paid = r.outcome === "paid";
  const explanation = r.check?.explanation.vi;
  return (
    <div
      aria-live="polite"
      className={`flex flex-col gap-2 rounded-xl border p-4 text-sm ${paid ? "border-success/40 bg-success-soft/40" : "border-danger/40 bg-danger-soft/40"}`}
    >
      <p className="flex items-center gap-2 font-semibold">
        {paid ? (
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
        ) : (
          <CircleXmark aria-hidden="true" className="size-4 text-danger" />
        )}
        {resultTitle(r)}
      </p>
      {r.outcome === "blocked" ? <p>{r.reason}</p> : null}
      {explanation && !(r.outcome === "blocked" && r.by === "guardian") ? (
        <p className="text-muted">{explanation}</p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {r.outcome !== "blocked" ? <TxLink hash={r.tx} label="Xem giao dịch" /> : null}
        {r.feeTx ? <TxLink hash={r.feeTx} label="Phí Guardian" /> : null}
      </div>
    </div>
  );
}
