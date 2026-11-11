"use client";
// Thay đổi on-chain tab: owner policy changes (also those drafted to apply a policy assignment). Draft here → the owner's wallet signs exactly the prepared call → the
// server verifies the transaction on chain. Nothing changes on the vault until the wallet signs.
import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useChainId, useSendTransaction, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { AccountApiError } from "@/lib/account";
import { deployment, knownName, tokenMeta, NETWORK } from "@/lib/config";
import { formatTime, shortHex } from "@/lib/format";
import { AddressLink, Card, Empty, ErrorBox, Loading, TxLink } from "@/components/ui";
import { ConfirmInline, Field, FormError, INPUT, Pill, errorOf } from "@/components/form";
import {
  POLICY_KIND_LABEL,
  POLICY_STATUS_LABEL,
  useAgents,
  useContacts,
  useInvalidate,
  usePolicyChanges,
  wsApi,
  type PolicyChange,
  type PolicyKind,
} from "@/lib/workspace";

const RISK_OPTIONS = [
  ["0", "Chỉ giao dịch rủi ro THẤP (khuyên dùng)"],
  ["1", "Đến TRUNG BÌNH"],
  ["2", "Cả rủi ro CAO"],
] as const;

const units = (raw: unknown, token: string) => {
  const m = tokenMeta(token);
  return `${formatUnits(BigInt(String(raw)), m.decimals)} ${m.symbol}`;
};
const avax = (raw: unknown) => `${formatUnits(BigInt(String(raw)), 18)} AVAX`;

/** One line that says what the change does, in words. */
function describe(c: PolicyChange): ReactNode {
  const p = c.params;
  switch (c.kind) {
    case "pause":
      return "Tạm dừng vault: mọi giao dịch của agent bị từ chối.";
    case "unpause":
      return "Mở lại vault cho agent.";
    case "revoke_agent":
      return "Thu hồi agent: không còn ví nào gửi giao dịch thay chủ.";
    case "set_agent":
      return (
        <>
          Đặt agent mới: <AddressLink address={String(p.agent)} />
        </>
      );
    case "allow_recipient":
    case "allow_target":
      return (
        <>
          {p.allowed ? "Cho phép" : "Gỡ quyền"} {c.kind === "allow_recipient" ? "nhận tiền" : "được gọi"}:{" "}
          <AddressLink address={String(p.address)} />
        </>
      );
    case "allow_selector":
      return (
        <>
          {p.allowed ? "Cho phép" : "Gỡ"} thao tác{" "}
          <code className="font-mono text-xs">{String(p.selector)}</code> trên{" "}
          {knownName(String(p.target)) ?? ""} <AddressLink address={String(p.target)} />
        </>
      );
    case "token_policy": {
      const t = String(p.token);
      const sym = tokenMeta(t).symbol;
      return p.tracked
        ? `${sym}: hạn mức ${units(p.dailyCap, t)}/ngày, cấp quyền tối đa ${units(p.maxApproval, t)}, cần Guardian ký từ ${units(p.verdictThreshold, t)}.`
        : `Bỏ theo dõi ${sym}: vault không còn giới hạn chi ${sym}.`;
    }
    case "native_policy":
      return `AVAX: hạn mức ${avax(p.dailyCap)}/ngày, cần Guardian ký từ ${avax(p.verdictThreshold)}.`;
    case "max_agent_risk":
      return RISK_OPTIONS.find(([v]) => v === String(p.risk))?.[1] ?? "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A submitted change is re-verified on chain every few seconds until it is mined. */
export function useSubmittedPolling(vault: string, changes: PolicyChange[] | undefined) {
  const invalidate = useInvalidate(vault);
  const pendingIds = (changes ?? [])
    .filter((c) => c.status === "submitted")
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const t = setInterval(() => {
      void Promise.all(
        pendingIds.split(",").map((id) => wsApi(vault, `policy-changes/${id}`).catch(() => null)),
      ).then(() => invalidate("policy", "assignments"));
    }, 4000);
    return () => clearInterval(t);
  }, [pendingIds, vault, invalidate]);
}

export function PolicyTab({ vault, ownerWallet }: { vault: string; ownerWallet: Address }) {
  const q = usePolicyChanges(vault);
  const invalidate = useInvalidate(vault);
  useSubmittedPolling(vault, q.data?.changes);
  const [warnings, setWarnings] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-6">
      <NewChange
        vault={vault}
        onCreated={(w) => {
          setWarnings(w);
          void invalidate("policy");
        }}
      />
      {warnings.length ? (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-medium-bg p-3 text-sm text-medium">
          <p className="font-semibold">Lưu ý về bản nháp vừa tạo</p>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
      <Card title="Các thay đổi on-chain">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorBox
            title="Không đọc được danh sách"
            detail={errorOf(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : q.data.changes.length === 0 ? (
          <Empty>Chưa có thay đổi nào.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.changes.map((c) => (
              <ChangeItem
                key={c.id}
                vault={vault}
                change={c}
                ownerWallet={ownerWallet}
                onChanged={() => invalidate("policy", "assignments")}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ChangeItem({
  vault,
  change,
  ownerWallet,
  onChanged,
  step,
}: {
  vault: string;
  change: PolicyChange;
  ownerWallet: Address;
  onChanged: () => void;
  /** "Bước 2/5" when the change is one of an ordered set. */
  step?: string;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const wrongWallet = isConnected && address?.toLowerCase() !== ownerWallet.toLowerCase();

  const sign = useMutation({
    mutationFn: async () => {
      if (NETWORK === "local") throw new Error("Không thể ký giao dịch ví trong chế độ fork.");
      if (!isConnected) throw new Error("Hãy kết nối ví chủ của vault trước.");
      if (chainId !== avalancheFuji.id) await switchChainAsync({ chainId: avalancheFuji.id });
      const hash = await sendTransactionAsync({
        to: change.transaction.to,
        data: change.transaction.data,
        value: 0n,
        chainId: avalancheFuji.id,
      });
      // The node may not know the transaction for a few seconds: retry while it is "not found".
      for (let i = 0; ; i++) {
        try {
          return await wsApi(vault, `policy-changes/${change.id}/submit`, "POST", { txHash: hash });
        } catch (e) {
          if (!(e instanceof AccountApiError && e.code === "tx_not_found") || i >= 9) throw e;
          await sleep(2000);
        }
      }
    },
    onSettled: onChanged,
  });
  const cancel = useMutation({
    mutationFn: () => wsApi(vault, `policy-changes/${change.id}`, "DELETE"),
    onSuccess: onChanged,
  });

  const tone =
    change.status === "confirmed"
      ? "ok"
      : change.status === "failed"
        ? "high"
        : change.status === "cancelled"
          ? "neutral"
          : "warn";
  return (
    <li className="flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {step ? <span className="text-xs font-semibold text-muted tabular-nums">{step}</span> : null}
        <span className="font-semibold">{POLICY_KIND_LABEL[change.kind]}</span>
        <Pill tone={tone}>{POLICY_STATUS_LABEL[change.status]}</Pill>
        <span className="text-xs text-muted tabular-nums">{formatTime(change.createdAt)}</span>
      </div>
      <p className="text-sm">{describe(change)}</p>
      {change.note ? <p className="text-sm text-muted">Ghi chú: {change.note}</p> : null}
      {change.txHash ? (
        <p className="text-sm">
          Giao dịch: <TxLink hash={change.txHash} />
        </p>
      ) : null}
      {change.status === "draft" ? (
        <>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Giao dịch ví sẽ ký</summary>
            <p className="mt-1 font-mono break-all">to: {change.transaction.to}</p>
            <p className="font-mono break-all">data: {change.transaction.data}</p>
            <p className="font-mono">value: 0</p>
          </details>
          {wrongWallet ? (
            <p role="alert" className="text-sm text-medium">
              Ví đang kết nối ({shortHex(address ?? "")}) không phải chủ vault ({shortHex(ownerWallet)}):
              vault sẽ từ chối giao dịch. Hãy chuyển sang ví chủ.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              type="button"
              isDisabled={
                NETWORK === "local" || sign.isPending || !isConnected || wrongWallet || cancel.isPending
              }
              onPress={() => sign.mutate()}
            >
              {sign.isPending ? "Đang chờ ví / xác minh…" : "Ký trong ví và gửi"}
            </Button>
            {confirmCancel ? (
              <ConfirmInline
                text="Huỷ bản nháp này?"
                confirmLabel="Huỷ bản nháp"
                pending={cancel.isPending}
                onConfirm={() => cancel.mutate()}
                onCancel={() => setConfirmCancel(false)}
              />
            ) : (
              <Button variant="secondary" type="button" onPress={() => setConfirmCancel(true)}>
                Huỷ
              </Button>
            )}
            {!isConnected ? (
              <span className="text-sm text-muted">Kết nối ví chủ ở thanh bên để ký.</span>
            ) : null}
          </div>
        </>
      ) : null}
      <FormError error={sign.error ?? cancel.error} />
    </li>
  );
}

function NewChange({ vault, onCreated }: { vault: string; onCreated: (warnings: string[]) => void }) {
  const agents = useAgents(vault);
  const contacts = useContacts(vault);
  const [kind, setKind] = useState<PolicyKind>("pause");
  const [agent, setAgent] = useState("");
  const [target, setTarget] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [tracked, setTracked] = useState(true);
  const [cap, setCap] = useState("20");
  const [maxApproval, setMaxApproval] = useState("10");
  const [threshold, setThreshold] = useState("1");
  const [risk, setRisk] = useState("0");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const amount = (v: string, decimals: number, field: string) => {
        try {
          return parseUnits(v.trim().replace(",", "."), decimals).toString();
        } catch {
          throw new Error(`${field} không phải số hợp lệ.`);
        }
      };
      const params: Record<string, unknown> =
        kind === "set_agent"
          ? { agent: agent.trim() }
          : kind === "allow_recipient" || kind === "allow_target"
            ? { address: target.trim(), allowed }
            : kind === "token_policy"
              ? {
                  token: deployment.usdc,
                  tracked,
                  dailyCap: amount(cap, 6, "Hạn mức/ngày"),
                  maxApproval: amount(maxApproval, 6, "Cấp quyền tối đa"),
                  verdictThreshold: amount(threshold, 6, "Ngưỡng cần verdict"),
                }
              : kind === "native_policy"
                ? {
                    dailyCap: amount(cap, 18, "Hạn mức/ngày"),
                    verdictThreshold: amount(threshold, 18, "Ngưỡng cần verdict"),
                  }
                : kind === "max_agent_risk"
                  ? { risk: Number(risk) }
                  : {};
      return wsApi<{ change: PolicyChange }>(vault, "policy-changes", "POST", { kind, params, note });
    },
    onSuccess: (r) => {
      setNote("");
      onCreated(r.change.warnings ?? []);
    },
  });

  const unit = kind === "native_policy" ? "AVAX" : "USDC";
  return (
    <Card title="Soạn một thay đổi riêng lẻ">
      <p className="text-sm text-muted">
        Cách thường dùng là gán policy cho agent ở tab Policy: dashboard tự lập các thay đổi cần ký. Mẫu dưới
        đây dành cho thao tác riêng lẻ như tạm dừng vault hay thu hồi agent. Server chỉ soạn giao dịch. Vault
        chỉ thay đổi khi bạn ký bằng ví chủ; sau đó server kiểm tra giao dịch trên chain (đúng vault, đúng nội
        dung, đúng ví). Rút tiền không làm ở đây.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="policy-kind" label="Loại thay đổi">
            <select
              id="policy-kind"
              value={kind}
              onChange={(e) => {
                create.reset();
                setKind(e.target.value as PolicyKind);
              }}
              className={INPUT}
            >
              {Object.entries(POLICY_KIND_LABEL)
                .filter(([v]) => v !== "allow_selector")
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </select>
          </Field>

          {kind === "set_agent" ? (
            <Field id="policy-agent" label="Agent mới" hint="Chọn từ danh sách agent hoặc dán địa chỉ.">
              <input
                id="policy-agent"
                list="policy-agent-options"
                required
                spellCheck={false}
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className={`${INPUT} font-mono`}
              />
              <datalist id="policy-agent-options">
                {agents.data?.agents.map((a) => (
                  <option key={a.id} value={a.address}>
                    {a.name}
                  </option>
                ))}
              </datalist>
            </Field>
          ) : null}

          {kind === "allow_recipient" || kind === "allow_target" ? (
            <>
              <Field id="policy-target" label="Địa chỉ" hint="Chọn từ danh bạ hoặc dán địa chỉ.">
                <input
                  id="policy-target"
                  list="policy-target-options"
                  required
                  spellCheck={false}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className={`${INPUT} font-mono`}
                />
                <datalist id="policy-target-options">
                  {contacts.data?.contacts.map((c) => (
                    <option key={c.id} value={c.address}>
                      {c.name}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field id="policy-allowed" label="Hành động">
                <select
                  id="policy-allowed"
                  value={allowed ? "1" : "0"}
                  onChange={(e) => setAllowed(e.target.value === "1")}
                  className={INPUT}
                >
                  <option value="1">Thêm vào danh sách được phép</option>
                  <option value="0">Gỡ khỏi danh sách được phép</option>
                </select>
              </Field>
            </>
          ) : null}

          {kind === "token_policy" ? (
            <Field id="policy-tracked" label="Theo dõi USDC">
              <select
                id="policy-tracked"
                value={tracked ? "1" : "0"}
                onChange={(e) => setTracked(e.target.value === "1")}
                className={INPUT}
              >
                <option value="1">Có: áp hạn mức</option>
                <option value="0">Không: bỏ hạn mức (không khuyên dùng)</option>
              </select>
            </Field>
          ) : null}

          {kind === "token_policy" || kind === "native_policy" ? (
            <>
              <Field id="policy-cap" label={`Hạn mức mỗi ngày (${unit})`}>
                <input
                  id="policy-cap"
                  inputMode="decimal"
                  required
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  className={INPUT}
                />
              </Field>
              {kind === "token_policy" ? (
                <Field id="policy-max-approval" label="Cấp quyền tối đa (USDC)">
                  <input
                    id="policy-max-approval"
                    inputMode="decimal"
                    required
                    value={maxApproval}
                    onChange={(e) => setMaxApproval(e.target.value)}
                    className={INPUT}
                  />
                </Field>
              ) : null}
              <Field id="policy-threshold" label={`Cần chữ ký Guardian từ (${unit})`}>
                <input
                  id="policy-threshold"
                  inputMode="decimal"
                  required
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className={INPUT}
                />
              </Field>
            </>
          ) : null}

          {kind === "max_agent_risk" ? (
            <Field id="policy-risk" label="Agent được chạy giao dịch">
              <select
                id="policy-risk"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                className={INPUT}
              >
                {RISK_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field id="policy-note" label="Ghi chú (không bắt buộc)">
            <input
              id="policy-note"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        <FormError error={create.error} />
        <Button variant="primary" type="submit" isDisabled={create.isPending} className="self-start">
          {create.isPending ? "Đang soạn…" : "Tạo bản nháp"}
        </Button>
      </form>
    </Card>
  );
}
