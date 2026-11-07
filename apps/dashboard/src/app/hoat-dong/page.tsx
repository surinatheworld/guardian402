"use client";
// Hoạt động: recent Guardian checks and the vault's Executed events (SPEC §11).
import { CheckCard } from "@/components/check-card";
import { Card, Empty, ErrorBox, Loading, PageHeader, TxLink } from "@/components/ui";
import { errorText, useChecks } from "@/lib/api";
import { useExecutedEvents } from "@/lib/events";
import { formatTime, shortHex } from "@/lib/format";
import { NETWORK } from "@/lib/config";

export default function Activity() {
  const checks = useChecks(50);
  const events = useExecutedEvents();

  return (
    <>
      <PageHeader
        title="Hoạt động"
        lead="Các lần Guardian kiểm tra gần đây, với mức rủi ro, luật đã kích hoạt và lời giải thích; bên dưới là các batch vault đã thực hiện trên chain."
      />

      <Card title="Lần kiểm tra gần đây">
        {checks.isPending ? <Loading /> : null}
        {checks.isError ? (
          <ErrorBox
            title="Không tải được danh sách kiểm tra"
            detail={errorText(checks.error)}
            onRetry={() => void checks.refetch()}
          />
        ) : null}
        {checks.data && !checks.data.checks.length ? (
          <Empty>
            Chưa có lần kiểm tra nào. Chạy một kịch bản ở trang Điều khiển, hoặc thử ở trang Kiểm tra giao
            dịch.
          </Empty>
        ) : null}
        {checks.data?.checks.length ? (
          <ul className="flex flex-col gap-3">
            {checks.data.checks.map((c) => (
              <CheckCard key={c.checkId} c={c} />
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Batch vault đã thực hiện (sự kiện Executed)">
        {events.isPending ? <Loading label="Đang đọc sự kiện trên chain…" /> : null}
        {events.isError ? (
          <ErrorBox
            title="Không đọc được sự kiện của vault"
            detail={events.error.message.split("\n")[0]}
            onRetry={() => void events.refetch()}
          />
        ) : null}
        {events.data && !events.data.length ? (
          <Empty>
            {NETWORK === "fuji"
              ? "Vault chưa thực hiện batch nào."
              : "Không có batch nào trong 100 block gần nhất của fork."}
          </Empty>
        ) : null}
        {events.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Các batch vault đã thực hiện</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Thời gian / block
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Giao dịch
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Verdict
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    checkId
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={`${e.txHash}-${e.checkId}`} className="border-t border-line">
                    <td className="py-2 pr-3 text-xs tabular-nums">
                      {e.timeMs ? formatTime(e.timeMs) : `#${e.blockNumber}`}
                    </td>
                    <td className="py-2 pr-3">
                      <TxLink hash={e.txHash} />
                    </td>
                    <td className="py-2 pr-3">{e.withVerdict ? `có (nonce ${e.nonceUsed})` : "không cần"}</td>
                    <td className="py-2 font-mono text-xs">
                      {e.withVerdict ? shortHex(e.checkId, 10, 6) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
