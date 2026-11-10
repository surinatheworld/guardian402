"use client";
// Tổng quan: vault balances, remaining daily caps, policy summary, agent and guardian addresses (SPEC §11).
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@heroui/react/button";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { fromDataUri, getErc8004Record } from "@guardian402/shared";
import { AddressLink, Card, ErrorBox, Facts, Loading, PageHeader, RiskBadge, TxLink } from "@/components/ui";
import { errorText, useChecks, useGuardianHealth } from "@/lib/api";
import { NETWORK, deployment, tokenMeta } from "@/lib/config";
import { formatAmount, formatTime, ZERO_ADDRESS } from "@/lib/format";
import { ENDPOINT_LABEL, RISK_LABEL, ruleLabel } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";

const RISK_BY_CODE = ["LOW", "MEDIUM", "HIGH"] as const;
// ERC-8004 identity of the Guardian on Fuji (bonus B1), written by `pnpm erc8004:fuji`.
const IDENTITY = NETWORK === "fuji" ? getErc8004Record() : undefined;
const IDENTITY_FILE = IDENTITY ? fromDataUri(IDENTITY.agentURI) : undefined;

export default function Overview() {
  const policy = useVaultPolicy();
  const health = useGuardianHealth();
  const checks = useChecks(50);
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "other">("all");
  const visibleChecks = (checks.data?.checks ?? [])
    .filter((c) => riskFilter === "all" || (riskFilter === "high" ? c.risk === "HIGH" : c.risk !== "HIGH"))
    .slice(0, 4);
  const p = policy.data;
  const usdc = p?.tokens.find((t) => t.token.toLowerCase() === deployment.usdc.toLowerCase());
  const spentPercent =
    usdc && usdc.dailyCap > 0n
      ? Number(((usdc.spentToday > usdc.dailyCap ? usdc.dailyCap : usdc.spentToday) * 100n) / usdc.dailyCap)
      : 0;
  // mWAVAX is what the vault receives from swaps; it is not a tracked token, so getPolicy() omits it.
  const mwavax = useReadContract({
    address: deployment.mWAVAX,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployment.vault],
    query: { refetchInterval: 10_000 },
  });

  return (
    <>
      <div className="h3-page-head">
        <PageHeader
          title="Tổng quan"
          lead="Tài sản, giới hạn và hoạt động của agent. Tiền luôn nằm trong vault của chủ ví; Guardian chỉ ký verdict, không chuyển được tiền."
        />
        <Link
          href="/kiem-tra"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg hover:opacity-90"
        >
          <span className="h3-plus">+</span> Kiểm tra giao dịch
        </Link>
      </div>

      {policy.isPending ? <Loading label="Đang đọc vault trên chain…" /> : null}
      {policy.isError ? (
        <ErrorBox
          title="Không đọc được AgentVault"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : null}

      {!p ? (
        <div className="h3-hero-grid">
          <Card title="Số dư trong vault" className="h3-balance-card">
            <div className="h3-balance">
              —<small>USDC</small>
            </div>
            <p className="h3-card-note">
              {policy.isPending ? "Đang đọc dữ liệu vault…" : "Chưa đọc được số dư vault."}
            </p>
          </Card>
          <Card title="AgentVault" className="h3-agent-card">
            <p className="h3-agent-title">Chưa có dữ liệu</p>
            <p className="h3-card-note">Trạng thái và hạn mức sẽ hiện khi kết nối được vault.</p>
            <Link
              href="/dieu-khien"
              className="mt-auto flex min-h-10 items-center justify-center rounded-xl bg-surface-2 px-4 text-sm font-semibold"
            >
              Chỉnh giới hạn
            </Link>
          </Card>
        </div>
      ) : null}
      {p ? (
        <>
          <div className="h3-hero-grid">
            <Card
              title="Số dư trong vault"
              className="h3-balance-card"
              actions={
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
                  {NETWORK === "fuji" ? "Fuji testnet" : "Fork Fuji"}
                </span>
              }
            >
              <div className="h3-balance">
                <span className="!text-inherit">
                  {usdc ? formatAmount(usdc.balance, tokenMeta(usdc.token).decimals) : "—"}
                </span>
                <small>USDC</small>
              </div>
              <p className="h3-card-note">Chủ ví sở hữu tài sản. Guardian chỉ ký verdict.</p>
              <div className="h3-balance-footer">
                <div className="h3-token-summary">
                  <strong className="text-base tabular-nums">
                    {mwavax.data !== undefined ? formatAmount(mwavax.data, 18) : "—"}
                  </strong>
                  <span className="text-xs text-muted">mWAVAX · mock</span>
                </div>
                <div className="h3-token-summary">
                  <strong className="text-base tabular-nums">{formatAmount(p.nativeBalance, 18)}</strong>
                  <span className="text-xs text-muted">AVAX · testnet</span>
                </div>
                <Link
                  href="#chi-tiet-vault"
                  className="ml-auto rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold"
                >
                  Xem vault ↗
                </Link>
              </div>
            </Card>
            <Card title="AgentVault" className="h3-agent-card">
              <div>
                <p className="h3-agent-title">{p.paused ? "Đã tạm dừng" : "Đang hoạt động"}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {p.paused
                    ? "Giao dịch mới của agent bị từ chối."
                    : "Agent có thể gửi giao dịch trong giới hạn."}
                </p>
              </div>
              <div>
                <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>Đã chi hôm nay</span>
                  <strong className="text-fg tabular-nums">
                    {usdc ? formatAmount(usdc.spentToday, tokenMeta(usdc.token).decimals) : "—"} /{" "}
                    {usdc ? formatAmount(usdc.dailyCap, tokenMeta(usdc.token).decimals) : "—"} USDC
                  </strong>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label="Hạn mức USDC đã chi hôm nay"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={spentPercent}
                >
                  <div className="h-full rounded-full bg-accent" style={{ width: `${spentPercent}%` }} />
                </div>
              </div>
              <Link
                href="/dieu-khien"
                className="mt-auto flex min-h-10 items-center justify-center rounded-xl bg-surface-2 px-4 text-sm font-semibold hover:bg-line"
              >
                Chỉnh giới hạn
              </Link>
            </Card>
          </div>
        </>
      ) : null}

      <Card
        className="h3-activity-card"
        title="Hoạt động gần đây"
        actions={
          <Link href="/hoat-dong" className="text-sm font-semibold text-muted hover:text-fg">
            Xem tất cả →
          </Link>
        }
      >
        <p className="text-xs text-muted">
          Các lần Guardian kiểm tra gần đây; kết quả thực thi on-chain được hiển thị trong Hoạt động.
        </p>
        <div
          className="inline-flex w-fit flex-wrap gap-1 rounded-xl bg-surface-2 p-1"
          aria-label="Lọc lần kiểm tra"
        >
          {(
            [
              ["all", "Tất cả"],
              ["high", "Rủi ro cao"],
              ["other", "Thấp và trung bình"],
            ] as const
          ).map(([value, label]) => (
            <Button
              variant="secondary"
              key={value}
              type="button"
              aria-pressed={riskFilter === value}
              onPress={() => setRiskFilter(value)}
              className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${riskFilter === value ? "bg-surface text-fg shadow-sm" : "text-muted"}`}
            >
              {label}
            </Button>
          ))}
        </div>
        {checks.isPending ? <Loading /> : null}
        {checks.isError ? (
          <ErrorBox
            title="Không tải được danh sách kiểm tra"
            detail={errorText(checks.error)}
            onRetry={() => void checks.refetch()}
          />
        ) : null}
        {checks.data && visibleChecks.length === 0 ? (
          <p className="py-4 text-sm text-muted">Không có lần kiểm tra phù hợp.</p>
        ) : null}
        {checks.data && visibleChecks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Các lần Guardian kiểm tra gần đây</caption>
              <thead className="rounded-xl bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="rounded-l-xl p-3 font-semibold" scope="col">
                    Kiểm tra
                  </th>
                  <th className="p-3 font-semibold" scope="col">
                    Rủi ro
                  </th>
                  <th className="p-3 font-semibold" scope="col">
                    Luật phát hiện
                  </th>
                  <th className="rounded-r-xl p-3 text-right font-semibold" scope="col">
                    Thời gian
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleChecks.map((c) => (
                  <tr key={c.checkId} className="border-b border-line last:border-0">
                    <td className="py-4 pr-3 font-semibold">{ENDPOINT_LABEL[c.endpoint] ?? c.endpoint}</td>
                    <td className="py-4 pr-3">
                      <RiskBadge risk={c.risk} />
                    </td>
                    <td className="py-4 pr-3 text-xs text-muted">
                      {c.ruleIds.length ? c.ruleIds.map(ruleLabel).join(", ") : "Không có"}
                    </td>
                    <td className="py-4 text-right text-xs text-muted">{formatTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {p ? (
        <>
          <Card title="Hạn mức hôm nay">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Hạn mức chi tiêu trong ngày theo token</caption>
                <thead className="text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Token
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Hạn mức/ngày
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Đã chi
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Còn lại
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Cần verdict từ
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {p.tokens.map((t) => {
                    const m = tokenMeta(t.token);
                    const left = t.dailyCap > t.spentToday ? t.dailyCap - t.spentToday : 0n;
                    return (
                      <tr key={t.token} className="border-t border-line">
                        <th scope="row" className="py-2 pr-3 font-medium">
                          {m.symbol}
                        </th>
                        <td className="py-2 pr-3">{formatAmount(t.dailyCap, m.decimals)}</td>
                        <td className="py-2 pr-3">{formatAmount(t.spentToday, m.decimals)}</td>
                        <td className="py-2 pr-3 font-semibold">{formatAmount(left, m.decimals)}</td>
                        <td className="py-2">{formatAmount(t.verdictThreshold, m.decimals)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      AVAX
                    </th>
                    <td className="py-2 pr-3">{formatAmount(p.nativeDailyCap, 18)}</td>
                    <td className="py-2 pr-3">{formatAmount(p.nativeSpentToday, 18)}</td>
                    <td className="py-2 pr-3 font-semibold">
                      {formatAmount(
                        p.nativeDailyCap > p.nativeSpentToday ? p.nativeDailyCap - p.nativeSpentToday : 0n,
                        18,
                      )}
                    </td>
                    <td className="py-2">{formatAmount(p.nativeVerdictThreshold, 18)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              Số đã chi tính ròng theo từng batch và đặt lại mỗi ngày (UTC). Batch vượt ngưỡng ở cột cuối phải
              kèm verdict của Guardian.
            </p>
          </Card>

          <div id="chi-tiet-vault" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Chính sách">
              <Facts
                rows={[
                  [
                    "Rủi ro tối đa",
                    `Agent chỉ được chạy batch có verdict rủi ro ${RISK_LABEL[RISK_BY_CODE[p.maxAgentRisk] ?? "HIGH"]}`,
                  ],
                  [
                    "Hợp đồng được gọi",
                    <ul key="t" className="flex flex-col gap-1">
                      {p.targets.map((t) => (
                        <li key={t.target}>
                          <AddressLink address={t.target} />{" "}
                          <span className="text-xs text-muted">· {t.selectors.length} hàm</span>
                        </li>
                      ))}
                    </ul>,
                  ],
                  [
                    "Người nhận được phép",
                    p.recipients.length ? (
                      <ul key="r" className="flex flex-col gap-1">
                        {p.recipients.map((r) => (
                          <li key={r}>
                            <AddressLink address={r} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "Không có"
                    ),
                  ],
                  ["Nonce verdict", p.verdictNonce.toString()],
                ]}
              />
            </Card>

            <Card title="Vai trò">
              <Facts
                rows={[
                  ["AgentVault", <AddressLink key="v" address={deployment.vault} />],
                  ["Chủ ví (owner)", <AddressLink key="o" address={p.owner} />],
                  ...(p.pendingOwner !== ZERO_ADDRESS
                    ? ([["Owner chờ nhận", <AddressLink key="po" address={p.pendingOwner} />]] as [
                        string,
                        ReactNode,
                      ][])
                    : []),
                  [
                    "Agent",
                    p.agent === ZERO_ADDRESS ? "Đã thu hồi" : <AddressLink key="a" address={p.agent} />,
                  ],
                  ["Guardian (ký verdict)", <AddressLink key="g" address={p.guardian} />],
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}

      <Card title="Guardian API">
        {health.isPending ? <Loading /> : null}
        {health.isError ? (
          <ErrorBox
            title="Guardian không phản hồi"
            detail={errorText(health.error)}
            onRetry={() => void health.refetch()}
          />
        ) : null}
        {health.data ? (
          <Facts
            rows={[
              [
                "Trạng thái",
                health.data.ok
                  ? "Đang chạy, fork mô phỏng sẵn sàng"
                  : "Đang chạy, fork mô phỏng chưa sẵn sàng",
              ],
              ["Mạng", health.data.network],
              [
                "Khoá ký verdict",
                <span key="s" className="flex flex-wrap items-baseline gap-2">
                  <AddressLink address={health.data.signer} />
                  {p ? (
                    p.guardian.toLowerCase() === health.data.signer.toLowerCase() ? (
                      <span className="text-xs text-low">✓ khớp guardian của vault</span>
                    ) : (
                      <span className="text-xs text-high">
                        ✗ khác guardian của vault: verdict sẽ bị từ chối
                      </span>
                    )
                  ) : null}
                </span>,
              ],
              ["Nhận phí x402", <AddressLink key="p" address={health.data.payTo} />],
              ["Block của fork", health.data.forkBlock ?? "chưa có"],
            ]}
          />
        ) : null}
      </Card>

      {IDENTITY && IDENTITY_FILE ? (
        <Card title="Danh tính ERC-8004">
          <Facts
            rows={[
              [
                "Agent",
                <span key="id" className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold">
                    {IDENTITY_FILE.name} #{IDENTITY.agentId}
                  </span>
                  <span className="text-xs text-low">✓ đã đăng ký trên Fuji</span>
                </span>,
              ],
              ["IdentityRegistry", <AddressLink key="r" address={IDENTITY.identityRegistry} />],
              ["Chủ sở hữu danh tính", <AddressLink key="o" address={IDENTITY.owner} />],
              ["Nhận thanh toán x402", IDENTITY_FILE.x402Support ? "Có" : "Không"],
              [
                "Dịch vụ công bố",
                <ul key="s" className="flex flex-col gap-1">
                  {IDENTITY_FILE.services.map((s) => (
                    <li key={s.name} className="break-all text-xs">
                      {s.name}: {s.endpoint}
                    </li>
                  ))}
                </ul>,
              ],
              [
                "Giao dịch",
                <span key="tx" className="flex flex-wrap gap-3">
                  <TxLink hash={IDENTITY.registerTx} label="đăng ký" />
                  <TxLink hash={IDENTITY.uriTx} label="file mô tả" />
                </span>,
              ],
            ]}
          />
          <p className="text-xs text-muted">
            Sổ danh tính agent theo chuẩn ERC-8004: agent khác tra agentId này để tìm Guardian và đọc file mô
            tả lưu ngay trên chain.
          </p>
        </Card>
      ) : null}
    </>
  );
}
