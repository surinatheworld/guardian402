"use client";
// Tổng quan: vault balances, remaining daily caps, policy summary, agent and guardian addresses (SPEC §11).
import type { ReactNode } from "react";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { fromDataUri, getErc8004Record } from "@guardian402/shared";
import { AddressLink, Card, ErrorBox, Facts, Loading, PageHeader, Stat, TxLink } from "@/components/ui";
import { errorText, useGuardianHealth } from "@/lib/api";
import { NETWORK, deployment, tokenMeta } from "@/lib/config";
import { formatAmount, ZERO_ADDRESS } from "@/lib/format";
import { RISK_LABEL } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";

const RISK_BY_CODE = ["LOW", "MEDIUM", "HIGH"] as const;
// ERC-8004 identity of the Guardian on Fuji (bonus B1), written by `pnpm erc8004:fuji`.
const IDENTITY = NETWORK === "fuji" ? getErc8004Record() : undefined;
const IDENTITY_FILE = IDENTITY ? fromDataUri(IDENTITY.agentURI) : undefined;

export default function Overview() {
  const policy = useVaultPolicy();
  const health = useGuardianHealth();
  const p = policy.data;
  // mWAVAX is what the vault receives from swaps; it is not a tracked token, so getPolicy() omits it.
  const tracked = new Set(p?.tokens.map((t) => t.token.toLowerCase()));
  const mwavax = useReadContract({
    address: deployment.mWAVAX,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployment.vault],
    query: { refetchInterval: 10_000 },
  });

  return (
    <>
      <PageHeader
        title="Tổng quan"
        lead="Số dư và hạn mức của AgentVault, chính sách đang áp dụng, và trạng thái Guardian. Tiền luôn nằm trong vault của chủ ví; Guardian chỉ ký verdict."
      />

      {policy.isPending ? <Loading label="Đang đọc vault trên chain…" /> : null}
      {policy.isError ? (
        <ErrorBox
          title="Không đọc được AgentVault"
          detail={policy.error.message.split("\n")[0]}
          onRetry={() => void policy.refetch()}
        />
      ) : null}

      {p ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {p.tokens.map((t) => {
              const m = tokenMeta(t.token);
              return (
                <Stat key={t.token} label={`Số dư ${m.symbol}`} value={formatAmount(t.balance, m.decimals)} />
              );
            })}
            {!tracked.has(deployment.mWAVAX.toLowerCase()) && mwavax.data !== undefined ? (
              <Stat label="Số dư mWAVAX" value={formatAmount(mwavax.data, 18)} hint="mock, nhận từ swap" />
            ) : null}
            <Stat label="Số dư AVAX" value={formatAmount(p.nativeBalance, 18)} />
            <Stat
              label="Trạng thái"
              value={p.paused ? "Tạm dừng" : "Hoạt động"}
              hint={p.paused ? "Mọi batch của agent bị từ chối" : "Agent có thể gửi batch"}
            />
          </div>

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

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
