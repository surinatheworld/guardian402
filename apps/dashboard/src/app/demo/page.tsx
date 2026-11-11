"use client";

import { Button } from "@heroui/react/button";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AddressLink, Card, ErrorBox, Loading, PageHeader, RiskBadge, TxLink } from "@/components/ui";
import { errorText, getJson, useAgentHealth } from "@/lib/api";
import { AGENT_URL, deployment } from "@/lib/config";
import { revertLabel } from "@/lib/labels";
import type { Attempt } from "@/lib/types";
import { useSelectedVault } from "@/lib/vault-context";

const scenarios = [
  {
    id: "S1",
    title: "Swap bình thường",
    description: "Agent đổi 2 USDC qua pool thử nghiệm. Nếu được chấp thuận, vault chi 2 USDC testnet.",
    expected: "Guardian đánh giá rủi ro thấp và vault thực hiện giao dịch.",
  },
  {
    id: "S2",
    title: "Yêu cầu rút tiền đáng ngờ",
    description: "Agent mô phỏng bị chèn lệnh, thử chuyển toàn bộ USDC đến địa chỉ lạ.",
    expected: "Guardian cảnh báo và vault từ chối giao dịch.",
  },
  {
    id: "S4",
    title: "Swap với giá bất lợi",
    description: "Agent thử swap 2 USDC qua pool mô phỏng có giá lệch 30%.",
    expected: "Guardian phát hiện trượt giá và vault từ chối verdict rủi ro cao.",
  },
] as const;
type Scenario = (typeof scenarios)[number];

export default function DemoPage() {
  const health = useAgentHealth();
  const { address: vault } = useSelectedVault();
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const run = useMutation({
    mutationFn: (id: string) =>
      getJson<Attempt>(`${AGENT_URL}/scenario/${id}`, {
        method: "POST",
        headers: { "x-guardian402-demo": "1" },
      }),
    onSuccess: (attempt) => {
      setResult(attempt);
      setSelected(null);
      void health.refetch();
    },
  });
  return (
    <>
      <PageHeader
        title="Thử Guardian"
        lead="Chọn một tình huống để xem Guardian đánh giá và vault xử lý giao dịch trên mạng thử."
      />
      <p className="text-sm text-muted">
        Oracle, pool và tấn công là mô phỏng. Giao dịch và phí dùng tài sản testnet; bạn không cần ví. Kịch
        bản chạy trên vault demo <AddressLink address={deployment.vault} />, không phụ thuộc vault đang chọn.
      </p>
      {health.isPending ? <Loading label="Đang kiểm tra dịch vụ demo…" /> : null}
      {health.isError ? (
        <ErrorBox
          title="Chưa kết nối được dịch vụ demo"
          detail="Dịch vụ chạy kịch bản chưa sẵn sàng. Hãy báo người trình bày kiểm tra và thử lại."
          onRetry={() => void health.refetch()}
        />
      ) : null}
      {health.data?.busy ? (
        <p role="status" className="text-sm text-muted">
          Một kịch bản đang chạy. Vui lòng đợi rồi thử lại.
        </p>
      ) : null}
      <Card title="Chọn tình huống">
        <div className="divide-y divide-line">
          {scenarios.map((scenario) => (
            <section
              key={scenario.id}
              className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="max-w-2xl">
                <h4 className="text-base font-semibold">{scenario.title}</h4>
                <p className="mt-1 text-sm text-muted">{scenario.description}</p>
              </div>
              <Button
                variant="secondary"
                type="button"
                isDisabled={!health.isSuccess || health.data.busy || run.isPending}
                onPress={() => {
                  run.reset();
                  setSelected(scenario);
                }}
              >
                Chọn tình huống
              </Button>
            </section>
          ))}
        </div>
      </Card>
      {selected ? (
        <Card title={`Chạy ${selected.title.toLowerCase()}?`}>
          <p className="text-sm">{selected.description}</p>
          <p className="text-sm text-muted">
            Dự kiến: {selected.expected} Kịch bản có thể trả phí x402 và gửi giao dịch testnet; kết quả thực
            tế sẽ hiện bên dưới.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              type="button"
              isDisabled={run.isPending || health.data?.busy === true}
              onPress={() => {
                setResult(null);
                run.mutate(selected.id);
              }}
            >
              {run.isPending ? "Đang chạy…" : "Chạy trên mạng thử"}
            </Button>
            <Button
              variant="secondary"
              type="button"
              isDisabled={run.isPending}
              onPress={() => setSelected(null)}
            >
              Huỷ
            </Button>
          </div>
          {run.isError ? <ErrorBox title="Không chạy được tình huống" detail={errorText(run.error)} /> : null}
        </Card>
      ) : null}
      {result ? (
        <Card title="Kết quả vừa chạy">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{scenarios.find((s) => s.id === result.scenario)?.title ?? result.scenario}</strong>
            {result.guardian?.risk ? <RiskBadge risk={result.guardian.risk} /> : null}
          </div>
          {result.guardian?.explanationVi ? (
            <p className="whitespace-pre-line text-sm">{result.guardian.explanationVi}</p>
          ) : (
            <p className="text-sm text-muted">Không có giải thích từ Guardian cho lần chạy này.</p>
          )}
          {result.vault.length ? (
            <ul className="space-y-2 text-sm">
              {result.vault.map((outcome, i) => (
                <li key={`${outcome.tx ?? i}`}>
                  <strong>Vault: </strong>
                  {outcome.status === "success"
                    ? "Đã thực hiện"
                    : outcome.status === "reverted"
                      ? `Đã từ chối: ${revertLabel(outcome.revert)}`
                      : "Chưa gửi giao dịch"}
                  {outcome.tx ? (
                    <>
                      {" "}
                      · <TxLink hash={outcome.tx} label="Xem giao dịch" />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">Chưa có kết quả thực thi từ vault.</p>
          )}
          {result.guardian?.paymentTx ? (
            <p className="text-sm">
              Phí x402: <TxLink hash={result.guardian.paymentTx} label="Xem thanh toán" />
            </p>
          ) : null}
          {!result.matched ? (
            <p role="status" className="text-sm text-high">
              Kết quả khác dự kiến: {result.mismatch ?? "kiểm tra trạng thái dịch vụ và vault."}
            </p>
          ) : null}
          {vault.toLowerCase() === deployment.vault.toLowerCase() ? (
            <Link href="/hoat-dong" className="self-start text-sm font-semibold underline underline-offset-2">
              Xem hoạt động của vault demo
            </Link>
          ) : null}
        </Card>
      ) : null}
      <p className="text-sm text-muted">
        Muốn thử dữ liệu riêng?{" "}
        <Link href="/kiem-tra" className="font-semibold underline underline-offset-2">
          Kiểm tra giao dịch
        </Link>{" "}
        chỉ mô phỏng, không gửi lên chain.
      </p>
    </>
  );
}
