"use client";
import { Button } from "@heroui/react/button";
// Điều khiển: owner actions sent from the connected wallet (pause/unpause, revoke agent, change caps), each
// behind a confirmation that shows exactly what changes; scenario buttons in DEMO mode (SPEC §11).
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { parseUnits, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { agentVaultAbi, USDC_FUJI } from "@guardian402/shared";
import { ConfirmDialog, type Change } from "@/components/confirm-dialog";
import {
  AddressLink,
  Card,
  Empty,
  ErrorBox,
  Facts,
  Loading,
  PageHeader,
  RiskBadge,
  TxLink,
} from "@/components/ui";
import { errorText, getJson, useAgentHealth } from "@/lib/api";
import { AGENT_URL, deployment, NETWORK } from "@/lib/config";
import { formatAmount, shortHex, ZERO_ADDRESS } from "@/lib/format";
import { revertLabel, SCENARIO_LABEL } from "@/lib/labels";
import type { Attempt } from "@/lib/types";
import { useSelectedVault } from "@/lib/vault-context";
import { useVaultPolicy } from "@/lib/vault";

type Pending = { title: string; changes: Change[]; call: string; note?: string; send: () => Promise<Hex> };

const usdc = (raw: bigint) => `${formatAmount(raw, USDC_FUJI.decimals, 6)} USDC`;

function parseUsdc(text: string): bigint | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  return parseUnits(t, USDC_FUJI.decimals);
}

export default function Controls() {
  const { address: vault } = useSelectedVault();
  return <VaultControls key={vault} vault={vault} />;
}

function VaultControls({ vault }: { vault: `0x${string}` }) {
  const policy = useVaultPolicy();
  const p = policy.data;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState<Pending | null>(null);
  const [sent, setSent] = useState<{ title: string; hash: Hex } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: sent?.hash, query: { enabled: Boolean(sent) } });

  const isOwner = Boolean(
    NETWORK !== "local" && p && address && p.owner.toLowerCase() === address.toLowerCase(),
  );
  const usdcPolicy = p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());

  const [cap, setCap] = useState("");
  const [maxApproval, setMaxApproval] = useState("");
  const [threshold, setThreshold] = useState("");

  async function confirm() {
    if (!pending) return;
    const job = pending;
    setPending(null);
    setSendError(null);
    try {
      if (chainId !== avalancheFuji.id) await switchChainAsync({ chainId: avalancheFuji.id });
      const hash = await job.send();
      setSent({ title: job.title, hash });
    } catch (e) {
      setSendError((e as Error).message.split("\n")[0] ?? String(e));
    }
  }

  const write = (functionName: "pause" | "unpause") => () =>
    writeContractAsync({
      address: vault,
      abi: agentVaultAbi,
      functionName,
      chainId: avalancheFuji.id,
    });

  const askPause = () => {
    if (!p) return;
    setPending({
      title: p.paused ? "Mở lại vault" : "Tạm dừng vault (kill switch)",
      changes: [
        {
          label: "Trạng thái",
          before: p.paused ? "Tạm dừng" : "Hoạt động",
          after: p.paused ? "Hoạt động" : "Tạm dừng",
        },
      ],
      call: `AgentVault.${p.paused ? "unpause" : "pause"}()`,
      note: p.paused
        ? "Agent sẽ gửi được batch trở lại, vẫn theo hạn mức và danh sách cho phép."
        : "Mọi batch của agent bị từ chối cho tới khi mở lại. Chủ ví vẫn rút tiền được.",
      send: write(p.paused ? "unpause" : "pause"),
    });
  };

  const askRevoke = () => {
    if (!p) return;
    setPending({
      title: "Thu hồi quyền của agent",
      changes: [{ label: "Agent", before: shortHex(p.agent), after: "không có (0x0)" }],
      call: `AgentVault.setAgent(${ZERO_ADDRESS})`,
      note: "Khoá agent hiện tại không gửi được batch nào nữa. Muốn cấp lại phải gọi setAgent với địa chỉ mới.",
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setAgent",
          args: [ZERO_ADDRESS],
          chainId: avalancheFuji.id,
        }),
    });
  };

  const [capError, setCapError] = useState<string | null>(null);
  const askCaps = (e: FormEvent) => {
    e.preventDefault();
    if (!usdcPolicy) return;
    const next = {
      dailyCap: cap.trim() ? parseUsdc(cap) : usdcPolicy.dailyCap,
      maxApproval: maxApproval.trim() ? parseUsdc(maxApproval) : usdcPolicy.maxApproval,
      verdictThreshold: threshold.trim() ? parseUsdc(threshold) : usdcPolicy.verdictThreshold,
    };
    if (next.dailyCap === null || next.maxApproval === null || next.verdictThreshold === null) {
      setCapError("Nhập số USDC, tối đa 6 chữ số thập phân (ví dụ 25 hoặc 2,5).");
      return;
    }
    const { dailyCap, maxApproval: ma, verdictThreshold: vt } = next as Record<keyof typeof next, bigint>;
    const changes: Change[] = [];
    if (dailyCap !== usdcPolicy.dailyCap)
      changes.push({ label: "Hạn mức/ngày", before: usdc(usdcPolicy.dailyCap), after: usdc(dailyCap) });
    if (ma !== usdcPolicy.maxApproval)
      changes.push({ label: "Cấp quyền tối đa", before: usdc(usdcPolicy.maxApproval), after: usdc(ma) });
    if (vt !== usdcPolicy.verdictThreshold)
      changes.push({ label: "Cần verdict từ", before: usdc(usdcPolicy.verdictThreshold), after: usdc(vt) });
    if (!changes.length) {
      setCapError("Không có gì thay đổi.");
      return;
    }
    setCapError(null);
    setPending({
      title: "Đổi hạn mức USDC",
      changes,
      call: `AgentVault.setTokenPolicy(USDC, true, ${dailyCap}, ${ma}, ${vt})`,
      send: () =>
        writeContractAsync({
          address: vault,
          abi: agentVaultAbi,
          functionName: "setTokenPolicy",
          args: [deployment.usdc, true, dailyCap, ma, vt],
          chainId: avalancheFuji.id,
        }),
    });
  };

  const disabledReason = !isConnected
    ? "Kết nối ví owner (nút ở góc trên) để dùng các nút này."
    : chainId !== avalancheFuji.id
      ? "Ví đang ở mạng khác; sẽ chuyển sang Fuji khi xác nhận."
      : !isOwner
        ? "Ví đang kết nối không phải owner của vault, giao dịch sẽ bị từ chối."
        : null;

  return (
    <>
      <PageHeader
        title="Điều khiển"
        lead="Thao tác của chủ ví, ký bằng ví của bạn (Core hoặc MetaMask) trên Fuji. Dashboard không giữ khoá nào."
      />

      <Card title="Thao tác của chủ ví">
        {policy.isPending ? <Loading label="Đang đọc vault…" /> : null}
        {policy.isError ? (
          <ErrorBox title="Không đọc được AgentVault" detail={policy.error.message.split("\n")[0]} />
        ) : null}
        {p ? (
          <>
            <Facts
              rows={[
                ["Vault", <AddressLink key="v" address={vault} />],
                ["Owner", <AddressLink key="o" address={p.owner} />],
                [
                  "Agent",
                  p.agent === ZERO_ADDRESS ? "Đã thu hồi" : <AddressLink key="a" address={p.agent} />,
                ],
                ["Trạng thái", p.paused ? "Tạm dừng" : "Hoạt động"],
              ]}
            />
            {disabledReason ? (
              <p role="note" className="rounded-lg bg-surface-2 p-2 text-sm">
                {disabledReason}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                type="button"
                onPress={askPause}
                isDisabled={!isOwner}
                className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                  p.paused ? "bg-accent text-accent-fg" : "bg-high text-surface"
                }`}
              >
                {p.paused ? "Mở lại vault" : "Tạm dừng vault"}
              </Button>
              <Button
                variant="danger-soft"
                type="button"
                onPress={askRevoke}
                isDisabled={!isOwner || p.agent === ZERO_ADDRESS}
                className="rounded-lg border border-high px-3 py-2 text-sm font-semibold text-high disabled:opacity-50"
              >
                Thu hồi agent
              </Button>
            </div>

            {usdcPolicy ? (
              <form onSubmit={askCaps} className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Hạn mức USDC</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["cap", "Hạn mức/ngày", cap, setCap, usdcPolicy.dailyCap],
                      [
                        "max-approval",
                        "Cấp quyền tối đa",
                        maxApproval,
                        setMaxApproval,
                        usdcPolicy.maxApproval,
                      ],
                      ["threshold", "Cần verdict từ", threshold, setThreshold, usdcPolicy.verdictThreshold],
                    ] as const
                  ).map(([id, label, value, set, current]) => (
                    <div key={id} className="flex flex-col gap-1">
                      <label htmlFor={id} className="text-sm">
                        {label} <span className="text-xs text-muted">(hiện tại {usdc(current)})</span>
                      </label>
                      <input
                        id={id}
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        placeholder={formatAmount(current, USDC_FUJI.decimals, 6)}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
                {capError ? (
                  <p role="alert" className="text-sm text-high">
                    {capError}
                  </p>
                ) : null}
                <Button
                  variant="primary"
                  type="submit"
                  isDisabled={!isOwner}
                  className="self-start rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
                >
                  Xem thay đổi
                </Button>
              </form>
            ) : null}
          </>
        ) : null}

        <div aria-live="polite" className="flex flex-col gap-2">
          {sendError ? <ErrorBox title="Giao dịch không được gửi" detail={sendError} /> : null}
          {sent ? (
            <p className="text-sm">
              {sent.title}: <TxLink hash={sent.hash} /> ·{" "}
              {receipt.isPending
                ? "đang chờ xác nhận…"
                : receipt.data?.status === "success"
                  ? "đã xác nhận"
                  : receipt.data
                    ? "bị từ chối on-chain"
                    : receipt.isError
                      ? "không đọc được biên nhận"
                      : null}
            </p>
          ) : null}
        </div>
      </Card>

      {vault.toLowerCase() === deployment.vault.toLowerCase() ? <Scenarios /> : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        changes={pending?.changes ?? []}
        call={pending?.call ?? ""}
        {...(pending?.note ? { note: pending.note } : {})}
        onConfirm={() => void confirm().then(() => policy.refetch())}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function Scenarios() {
  const agent = useAgentHealth();
  const [results, setResults] = useState<Attempt[]>([]);
  const run = useMutation({
    // The header forces a CORS preflight that only the dashboard origin passes (apps/agent/src/control.ts).
    mutationFn: (id: string) =>
      getJson<Attempt>(`${AGENT_URL}/scenario/${id}`, {
        method: "POST",
        headers: { "x-guardian402-demo": "1" },
      }),
    onSuccess: (a) => setResults((r) => [a, ...r].slice(0, 6)),
  });

  let body: ReactNode;
  if (agent.isPending) body = <Loading />;
  else if (agent.isError)
    body = (
      <Empty>
        Control API của agent không chạy. Ở DEMO MODE, chạy <code className="font-mono">pnpm dev:agent</code>{" "}
        rồi tải lại trang.
      </Empty>
    );
  else
    body = (
      <>
        <p className="text-sm text-muted">
          Agent <AddressLink address={agent.data.agent} /> trên{" "}
          {agent.data.network === "fuji" ? "Fuji" : "fork"}. Mỗi nút chạy một kịch bản thật: trả phí x402 và
          gửi giao dịch vào vault. S2–S5 là tấn công mô phỏng (DEMO).
        </p>
        {agent.data.network === "fuji" ? (
          <p className="text-sm text-muted">
            S6 cần ví chủ hiện tại: dùng nút tạm dừng ở trên, rồi mở lại khi kiểm tra xong.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(SCENARIO_LABEL).map(([id, label]) => (
            <Button
              variant="secondary"
              key={id}
              type="button"
              isDisabled={run.isPending || agent.data.busy || (id === "S6" && agent.data.network === "fuji")}
              onPress={() => run.mutate(id)}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-sm font-medium hover:border-accent disabled:opacity-50"
            >
              {run.isPending && run.variables === id ? "Đang chạy… " : ""}
              {label}
            </Button>
          ))}
        </div>
        {run.isError ? <ErrorBox title="Kịch bản lỗi" detail={errorText(run.error)} /> : null}
        <ul aria-live="polite" className="flex flex-col gap-2">
          {results.map((a) => (
            <li key={a.at} className="flex flex-col gap-1 rounded-lg border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{SCENARIO_LABEL[a.scenario] ?? a.scenario}</span>
                {a.guardian?.risk ? <RiskBadge risk={a.guardian.risk} /> : null}
                <span className={a.matched ? "text-low" : "text-high"}>
                  {a.matched ? "✓ đúng như bảng kịch bản" : `✗ khác mong đợi: ${a.mismatch ?? ""}`}
                </span>
              </div>
              {a.guardian?.explanationVi ? (
                <p className="whitespace-pre-line">{a.guardian.explanationVi}</p>
              ) : null}
              {a.guardian?.paymentTx ? (
                <p className="text-xs text-muted">
                  Phí x402: <TxLink hash={a.guardian.paymentTx} />
                </p>
              ) : null}
              {a.vault.map((o, i) => (
                <p key={o.tx ?? i} className="text-xs">
                  Vault:{" "}
                  {o.status === "success"
                    ? "đã thực hiện"
                    : o.status === "reverted"
                      ? `từ chối, ${revertLabel(o.revert)}`
                      : "không gửi"}{" "}
                  {o.tx ? <TxLink hash={o.tx} /> : null}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </>
    );

  return <Card title="Kịch bản demo (DEMO)">{body}</Card>;
}
