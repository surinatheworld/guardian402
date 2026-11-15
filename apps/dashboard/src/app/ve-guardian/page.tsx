"use client";
// Về Guardian: how the Guardian protects a vault, its live status and signer, and the x402 fees it collects
// (the old Doanh thu page). The one place that explains the system itself.
import { GuardianReputation } from "@/components/reputation";
import { Card, ErrorBox, Facts, LoadingRows, PageHeader, Stat, TxLink, AddressLink } from "@/components/ui";
import { errorText, useGuardianHealth, useStats } from "@/lib/api";
import { deployment } from "@/lib/config";
import { useFactoryStats } from "@/lib/events";
import { formatAmount, formatCount, formatTime } from "@/lib/format";
import { ENDPOINT_LABEL, PAGE, RISK_TITLE } from "@/lib/labels";
import { useVaultPolicy } from "@/lib/vault";
import { useSelectedVault } from "@/lib/vault-context";

export default function AboutPage() {
  const health = useGuardianHealth();
  const stats = useStats();
  const p = useVaultPolicy().data;
  const { address: shown } = useSelectedVault();
  const demoVault = shown.toLowerCase() === deployment.vault.toLowerCase();
  const factory = useFactoryStats();
  const s = stats.data;
  return (
    <>
      <PageHeader title={PAGE.about}>Dịch vụ kiểm tra và ký duyệt giao dịch cho két của AI agent.</PageHeader>
      <Card title="Cách Guardian bảo vệ két">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Chạy thử giao dịch trên một bản sao (fork) của Avalanche Fuji để xem tiền sẽ đi đâu.</li>
          <li>Chấm rủi ro bằng bộ luật cố định. AI không quyết định mức rủi ro.</li>
          <li>AI chỉ viết lời giải thích tiếng Việt và tiếng Anh từ kết quả chạy thử.</li>
          <li>
            Ký phê duyệt gắn với đúng giao dịch đó. Két tự kiểm tra hạn mức, danh sách tin cậy và khoá khẩn
            cấp.
          </li>
        </ol>
        <p className="text-sm text-muted">
          Guardian chỉ ký phê duyệt; tiền luôn nằm trong két của chủ và chủ rút được bất cứ lúc nào.
        </p>
      </Card>
      <Card title="Trạng thái dịch vụ">
        {health.isPending ? <LoadingRows rows={3} /> : null}
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
                health.data.ok ? "Đang chạy, chạy thử sẵn sàng" : "Đang chạy, chạy thử chưa sẵn sàng",
              ],
              [
                "Khoá ký phê duyệt",
                <span key="s" className="flex flex-wrap items-baseline gap-2">
                  <AddressLink address={health.data.signer} />
                  {p ? (
                    p.guardian.toLowerCase() === health.data.signer.toLowerCase() ? (
                      <span className="text-xs text-success-soft-foreground">khớp Guardian của két</span>
                    ) : demoVault ? (
                      <span className="text-xs text-muted">
                        Két demo tin khoá <AddressLink address={p.guardian} /> của máy chạy kịch bản S0–S6,
                        không phải khoá này. Bản công khai chỉ chấm thử két demo, không ký cho nó; két tạo ở
                        trang Bắt đầu dùng đúng khoá này.
                      </span>
                    ) : (
                      <span className="text-xs text-danger">
                        Két đang xem tin khoá <AddressLink address={p.guardian} />: phê duyệt do khoá này ký
                        sẽ bị két từ chối (BadSignature). Chủ két đổi Guardian ở trang Quy tắc.
                      </span>
                    )
                  ) : null}
                </span>,
              ],
              ["Nhận phí kiểm tra", <AddressLink key="p" address={health.data.payTo} />],
              [
                "Mạng",
                health.data.network === "fuji"
                  ? "Avalanche Fuji (mạng thử)"
                  : "Fork của Avalanche Fuji (DEMO)",
              ],
            ]}
          />
        ) : null}
      </Card>
      {deployment.factory ? (
        <Card
          title="Két tạo trên Avalanche Fuji"
          description="Đếm từ sự kiện VaultCreated của VaultFactory trên chain (qua Snowtrace), không phải số liệu tự khai"
        >
          {factory.isPending ? <LoadingRows rows={1} /> : null}
          {factory.isError ? (
            <ErrorBox
              title="Không đọc được sự kiện trên Snowtrace"
              detail={errorText(factory.error)}
              onRetry={() => void factory.refetch()}
            />
          ) : null}
          {factory.data ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Stat label="Két đã tạo" value={formatCount(factory.data.vaults)} />
              <Stat label="Ví chủ két" value={formatCount(factory.data.owners)} />
              <Stat label="Ví agent" value={formatCount(factory.data.agents)} />
            </div>
          ) : null}
          <Facts rows={[["VaultFactory", <AddressLink key="f" address={deployment.factory} />]]} />
        </Card>
      ) : null}
      <Card
        title="Uy tín trên chain (ERC-8004)"
        description="Điểm do các chủ két ghi lên ReputationRegistry chính thức trên Avalanche Fuji"
      >
        <GuardianReputation />
      </Card>
      <Card
        title="Phí kiểm tra (x402)"
        description="0,005 USDC mỗi lần kiểm tra, 0,01 USDC mỗi lần kiểm tra và duyệt; chỉ thu khi Guardian trả lời thành công. Số liệu của cả Guardian này, mọi ví đã trả, không riêng két đang xem."
      >
        {stats.isError ? (
          <ErrorBox
            title="Không tải được thống kê"
            detail={errorText(stats.error)}
            onRetry={() => void stats.refetch()}
          />
        ) : null}
        {s ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Lần thu phí" value={formatCount(s.payments.count)} />
              <Stat label="Guardian đã thu" value={`${formatAmount(s.payments.totalAtomic, 6, 6)} USDC`} />
              <Stat label="Thời gian xử lý (p50)" value={`${s.latencyMs.p50} ms`} />
              <Stat label="Thời gian xử lý (p95)" value={`${s.latencyMs.p95} ms`} />
            </div>
            <p className="text-sm text-muted">
              {(["LOW", "MEDIUM", "HIGH"] as const)
                .map((r) => `${RISK_TITLE[r]}: ${formatCount(s.checks[r])}`)
                .join(" · ")}
            </p>
            <ul className="flex flex-col divide-y divide-separator text-sm">
              {s.recentPayments.slice(0, 10).map((x) => (
                <li key={x.txHash} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {ENDPOINT_LABEL[x.endpoint] ?? x.endpoint} · {formatAmount(x.amount, 6, 6)} USDC
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted tabular-nums">
                    {formatTime(x.createdAt)} <TxLink hash={x.txHash} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </>
  );
}
