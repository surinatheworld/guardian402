"use client";
// Doanh thu: x402 payments count and sum, settlement links (SPEC §11).
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, TxLink } from "@/components/ui";
import { errorText, useStats } from "@/lib/api";
import { formatAmount, formatCount, formatTime, shortHex } from "@/lib/format";
import { ENDPOINT_LABEL, RISK_LABEL } from "@/lib/labels";

export default function Revenue() {
  const stats = useStats();
  const s = stats.data;

  return (
    <>
      <PageHeader
        title="Doanh thu"
        lead="Mỗi lần kiểm tra được trả phí bằng USDC qua x402: 0,005 USDC cho /v1/check, 0,01 USDC cho /v1/cosign. Phí chỉ bị thu khi Guardian trả lời thành công."
      />
      {stats.isPending ? <Loading /> : null}
      {stats.isError ? (
        <ErrorBox
          title="Không tải được thống kê"
          detail={errorText(stats.error)}
          onRetry={() => void stats.refetch()}
        />
      ) : null}
      {s ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Số lần thanh toán" value={formatCount(s.payments.count)} />
            <Stat label="Tổng thu" value={`${formatAmount(s.payments.totalAtomic, 6, 6)} USDC`} />
            <Stat label="Độ trễ p50" value={`${s.latencyMs.p50} ms`} hint="pipeline của Guardian" />
            <Stat label="Độ trễ p95" value={`${s.latencyMs.p95} ms`} />
          </div>
          <Card title="Lần kiểm tra theo mức rủi ro">
            <div className="grid grid-cols-3 gap-3">
              {(["LOW", "MEDIUM", "HIGH"] as const).map((r) => (
                <Stat key={r} label={RISK_LABEL[r]} value={formatCount(s.checks[r])} />
              ))}
            </div>
          </Card>
          <Card title="Thanh toán gần đây">
            {!s.recentPayments.length ? (
              <Empty>
                Chưa có khoản thanh toán nào. Trang Kiểm tra giao dịch dùng endpoint demo miễn phí.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <caption className="sr-only">Các khoản thanh toán x402 gần đây</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Thời gian
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Endpoint
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Số tiền
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Người trả
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Settlement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recentPayments.map((p) => (
                      <tr key={p.txHash} className="border-t border-line">
                        <td className="py-2 pr-3 text-xs">{formatTime(p.createdAt)}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {ENDPOINT_LABEL[p.endpoint] ?? p.endpoint}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{formatAmount(p.amount, 6, 6)} USDC</td>
                        <td className="py-2 pr-3 font-mono text-xs">{p.payer ? shortHex(p.payer) : "—"}</td>
                        <td className="py-2">
                          <TxLink hash={p.txHash} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
