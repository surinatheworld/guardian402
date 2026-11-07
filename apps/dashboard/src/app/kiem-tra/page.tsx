"use client";
// Kiểm tra giao dịch: paste a calls JSON or pick a scenario and see the Guardian result (SPEC §11).
// Uses the free /v1/demo/check, which exists only in DEMO mode. Nothing is signed or sent on-chain.
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { FUJI_CHAIN_ID, type CheckResponse } from "@guardian402/shared";
import { AddressLink, Card, Empty, ErrorBox, Facts, PageHeader, RiskBadge } from "@/components/ui";
import { errorText, getJson, HttpError, useGuardianHealth } from "@/lib/api";
import { deployment, GUARDIAN_URL, tokenMeta } from "@/lib/config";
import { formatAmount, isUnlimited } from "@/lib/format";
import { ruleLabel } from "@/lib/labels";
import { PRESETS } from "@/lib/presets";
import { useVaultPolicy } from "@/lib/vault";

const usdcOf = (p: ReturnType<typeof useVaultPolicy>["data"]) =>
  p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase())?.balance ?? 0n;

export default function CheckPage() {
  const health = useGuardianHealth();
  const policy = useVaultPolicy();
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (calls: unknown) =>
      getJson<CheckResponse>(`${GUARDIAN_URL}/v1/demo/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: FUJI_CHAIN_ID, vault: deployment.vault, calls, lang: "vi" }),
      }),
  });

  const pick = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setText(JSON.stringify(preset.calls(deployment, usdcOf(policy.data)), null, 2));
    setParseError(null);
    run.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let calls: unknown;
    try {
      calls = JSON.parse(text);
    } catch {
      setParseError("JSON không hợp lệ. Cần một mảng [{ target, value, data }].");
      return;
    }
    if (!Array.isArray(calls) || !calls.length) {
      setParseError("Cần một mảng có từ 1 tới 8 lệnh [{ target, value, data }].");
      return;
    }
    setParseError(null);
    run.mutate(calls);
  };

  const demoOff = health.data && !health.data.demoMode;
  const r = run.data;

  return (
    <>
      <PageHeader
        title="Kiểm tra giao dịch"
        lead="Dán danh sách lệnh của agent hoặc chọn một kịch bản; Guardian mô phỏng trên fork của Fuji, chấm điểm bằng luật cố định và giải thích. Không có gì được ký hay gửi lên chain."
      />
      {demoOff ? (
        <ErrorBox
          title="Trang này chỉ dùng được ở DEMO MODE"
          detail="Guardian đang chạy với DEMO_MODE=false nên không có /v1/demo/check."
        />
      ) : null}

      <Card title="Lệnh cần kiểm tra">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="preset" className="text-sm font-medium">
              Chọn kịch bản
            </label>
            <select
              id="preset"
              defaultValue=""
              onChange={(e) => pick(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="" disabled>
                — chọn để điền sẵn —
              </option>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="calls" className="text-sm font-medium">
              Danh sách lệnh (JSON)
            </label>
            <textarea
              id="calls"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              aria-describedby="calls-help"
              placeholder='[{ "target": "0x…", "value": "0", "data": "0x…" }]'
              className="min-w-0 rounded-lg border border-line bg-surface p-3 font-mono text-xs"
            />
            <p id="calls-help" className="text-xs text-muted">
              Vault: <AddressLink address={deployment.vault} /> · tối đa 8 lệnh · value tính bằng wei.
            </p>
          </div>
          {parseError ? (
            <p role="alert" className="text-sm text-high">
              {parseError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={run.isPending || !text.trim()}
            className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-60"
          >
            {run.isPending ? "Đang mô phỏng…" : "Kiểm tra"}
          </button>
        </form>
      </Card>

      <div aria-live="polite" className="contents">
        {run.isError ? (
          <ErrorBox
            title={
              run.error instanceof HttpError && run.error.status === 400
                ? "Yêu cầu không hợp lệ"
                : "Kiểm tra thất bại"
            }
            detail={
              run.error instanceof HttpError && run.error.status === 400
                ? JSON.stringify((run.error.body as { details?: unknown } | null)?.details ?? run.error.body)
                : errorText(run.error)
            }
          />
        ) : null}
        {r ? (
          <Card title="Kết quả">
            <div className="flex flex-wrap items-center gap-3">
              <RiskBadge risk={r.risk} score={r.score} />
              <span className="text-xs text-muted">{r.latencyMs} ms</span>
            </div>
            <p className="max-w-[75ch] leading-relaxed whitespace-pre-line">{r.explanation.vi}</p>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">English</summary>
              <p className="mt-1 max-w-[75ch] whitespace-pre-line">{r.explanation.en}</p>
            </details>

            <h3 className="text-sm font-semibold">Luật đã kích hoạt</h3>
            {r.findings.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {r.findings.map((f, i) => (
                  <li key={`${f.ruleId}-${i}`}>
                    <span className="font-medium">{ruleLabel(f.ruleId)}</span>{" "}
                    <span className="text-muted">
                      ({f.severity}) · {f.title}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Không luật nào kích hoạt.</Empty>
            )}

            <h3 className="text-sm font-semibold">Thay đổi số dư của vault (mô phỏng)</h3>
            <Facts
              rows={[
                ...r.diff.tokenDeltas.map(
                  (t) =>
                    [
                      t.symbol,
                      `${BigInt(t.delta) > 0n ? "+" : ""}${formatAmount(t.delta, t.decimals, 6)}`,
                    ] as [string, string],
                ),
                ...(BigInt(r.diff.nativeDelta) !== 0n
                  ? [["AVAX", formatAmount(r.diff.nativeDelta, 18, 6)] as [string, string]]
                  : []),
                ...r.diff.approvals.map(
                  (a, i) =>
                    [
                      `Cấp quyền ${i + 1}`,
                      <span key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                        {isUnlimited(a.amount) || a.unlimited
                          ? "không giới hạn"
                          : `${formatAmount(a.amount, tokenMeta(a.token).decimals)} ${tokenMeta(a.token).symbol}`}{" "}
                        cho <AddressLink address={a.spender} />
                      </span>,
                    ] as [string, ReactNode],
                ),
                [
                  "Mô phỏng",
                  r.simulation.success
                    ? `thành công · gas ${r.simulation.gasUsed} · block ${r.simulation.forkBlock}`
                    : `thất bại${r.simulation.revertReason ? `: ${r.simulation.revertReason}` : ""}`,
                ],
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
