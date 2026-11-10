"use client";
// Đã chặn: HIGH checks and the agent attempts the vault reverted, with reasons (SPEC §11).
import { CheckCard } from "@/components/check-card";
import { Card, Empty, ErrorBox, Loading, PageHeader, RiskBadge, TxLink } from "@/components/ui";
import { errorText, useAgentHealth, useAttempts, useChecks } from "@/lib/api";
import { NETWORK } from "@/lib/config";
import { formatTime } from "@/lib/format";
import { revertLabel, SCENARIO_LABEL } from "@/lib/labels";

export default function Blocked() {
  const checks = useChecks(200);
  const agent = useAgentHealth();
  const attempts = useAttempts(agent.isSuccess);
  const high = checks.data?.checks.filter((c) => c.risk === "HIGH") ?? [];
  // Attempts from another network (e.g. fork runs) have hashes that are not on this network's explorer.
  const reverted = (attempts.data?.attempts ?? []).filter(
    (a) => a.network === NETWORK && a.vault.some((o) => o.status === "reverted"),
  );

  return (
    <>
      <PageHeader
        title="Đã chặn"
        lead="Giao dịch Guardian đánh giá rủi ro CAO, và các lần agent gửi thẳng vào vault nhưng bị luật on-chain từ chối."
      />

      <Card title="Vault đã từ chối">
        {agent.isPending ? <Loading /> : null}
        {agent.isError ? (
          <Empty>
            Control API của agent không chạy (chỉ có ở DEMO, lệnh{" "}
            <code className="font-mono">pnpm dev:agent</code>), nên không có danh sách lần thử. Các check rủi
            ro CAO vẫn hiện bên dưới.
          </Empty>
        ) : null}
        {attempts.isError ? (
          <ErrorBox title="Không tải được lần thử của agent" detail={errorText(attempts.error)} />
        ) : null}
        {attempts.data && !reverted.length ? <Empty>Chưa có lần nào bị vault từ chối.</Empty> : null}
        {reverted.length ? (
          <ul className="flex flex-col gap-3">
            {reverted.map((a) => (
              <li
                key={a.at + a.scenario}
                className="flex flex-col gap-2 rounded-[22px] bg-surface p-6 shadow-[0_2px_3px_#20273506,0_6px_18px_#2027350a]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">{SCENARIO_LABEL[a.scenario] ?? a.scenario}</span>
                  {a.guardian?.risk ? <RiskBadge risk={a.guardian.risk} /> : null}
                  <time className="text-xs text-muted" dateTime={a.at}>
                    {formatTime(Date.parse(a.at))}
                  </time>
                  {a.mode === "scripted-attack" ? (
                    <span className="rounded bg-demo-bg px-1.5 text-xs text-demo">tấn công mô phỏng</span>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {a.vault
                    .filter((o) => o.status === "reverted")
                    .map((o, i) => (
                      <li key={o.tx ?? i} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-high">Từ chối: {revertLabel(o.revert)}</span>
                        {o.tx ? <TxLink hash={o.tx} /> : null}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Guardian đánh giá rủi ro CAO">
        {checks.isPending ? <Loading /> : null}
        {checks.isError ? (
          <ErrorBox
            title="Không tải được danh sách kiểm tra"
            detail={errorText(checks.error)}
            onRetry={() => void checks.refetch()}
          />
        ) : null}
        {checks.data && !high.length ? <Empty>Chưa có giao dịch nào bị đánh giá rủi ro CAO.</Empty> : null}
        {high.length ? (
          <ul className="flex flex-col gap-3">
            {high.map((c) => (
              <CheckCard key={c.checkId} c={c} />
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
