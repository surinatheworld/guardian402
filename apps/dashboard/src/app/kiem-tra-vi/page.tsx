"use client";
// Kiểm tra ví: any wallet, no vault. Paste the transaction a dapp asks you to sign (or build an approval or a
// USDC transfer), and the Guardian simulates it from your address on a fork of Fuji, scores it with its fixed
// rules (unlimited approval, unknown or unverified contract, lookalike address, drain, abnormal slippage) and
// explains it. Free here (DEMO /v1/demo/wallet-check); wallets and apps pay 0.005 USDC per check over x402 on
// /v1/wallet/check. Nothing is sent and nothing is signed: the result only says what would happen.
import { Button } from "@heroui/react/button";
import { Checkbox } from "@heroui/react/checkbox";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { Tabs } from "@heroui/react/tabs";
import { TextArea } from "@heroui/react/textarea";
import { TextField } from "@heroui/react/textfield";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { FUJI_CHAIN_ID, type CheckResponse } from "@guardian402/shared";
import { TextInput } from "@/components/fields";
import { Card, ErrorBox, Notice, PageHeader, RiskBadge, RuleChips, TechDetails } from "@/components/ui";
import { errorText, getJson, HttpError, useGuardianHealth } from "@/lib/api";
import {
  approveCall,
  describeCall,
  rawCall,
  transferCall,
  type CallJson,
  type Parsed,
} from "@/lib/check-calls";
import { deployment, GUARDIAN_URL, tokenMeta } from "@/lib/config";
import { formatAmount } from "@/lib/format";
import { PAGE } from "@/lib/labels";

type Kind = "cap-quyen" | "chuyen" | "tho";

const knownToken = (a: Address) => {
  const m = tokenMeta(a);
  return m.symbol === "token" ? undefined : m;
};

/** One trusted address per line (or comma separated); invalid lines are reported, not dropped silently. */
function parseBook(text: string): Parsed<Address[]> {
  const parts = text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const bad = parts.find((x) => !isAddress(x, { strict: false }));
  if (bad) return { ok: false, error: `"${bad}" không phải địa chỉ 0x… hợp lệ.` };
  if (parts.length > 20) return { ok: false, error: "Tối đa 20 địa chỉ quen." };
  return { ok: true, value: [...new Set(parts.map((x) => getAddress(x)))] };
}

export default function WalletCheckPage() {
  const health = useGuardianHealth();
  const { address: connected } = useAccount();
  const [wallet, setWallet] = useState("");
  const [kind, setKind] = useState<Kind>("cap-quyen");
  const [spender, setSpender] = useState("");
  const [approveAmount, setApproveAmount] = useState("10");
  const [unlimited, setUnlimited] = useState(true);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  const [rawTo, setRawTo] = useState("");
  const [rawValue, setRawValue] = useState("0");
  const [rawData, setRawData] = useState("0x");
  const [book, setBook] = useState("");
  const [error, setError] = useState<string | null>(null);

  const demoOff = health.data ? !health.data.demoMode : false;
  const calls = (): Parsed<CallJson[]> =>
    kind === "cap-quyen"
      ? approveCall(deployment.usdc, 6, spender, approveAmount, unlimited)
      : kind === "chuyen"
        ? transferCall(deployment.usdc, 6, to, amount)
        : rawCall(rawTo, rawValue, rawData);
  const preview = calls();

  const [retrying, setRetrying] = useState(false);
  const check = useMutation({
    // A 503 is the Guardian catching up (its fork loading state for an address it has not seen, or busy): not
    // charged and usually gone in seconds, so ask again twice before showing an error.
    mutationFn: async (p: { wallet: Address; calls: CallJson[]; addressBook: Address[] }) => {
      const init = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: FUJI_CHAIN_ID,
          wallet: p.wallet,
          calls: p.calls,
          lang: "vi",
          ...(p.addressBook.length ? { addressBook: p.addressBook } : {}),
        }),
      };
      for (let attempt = 0; ; attempt++) {
        try {
          return await getJson<CheckResponse>(`${GUARDIAN_URL}/v1/demo/wallet-check`, init);
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 503 || attempt >= 2) throw e;
          setRetrying(true);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    },
    onSettled: () => setRetrying(false),
  });

  const edited = () => {
    setError(null);
    if (!check.isPending) check.reset();
  };
  const run = () => {
    if (!isAddress(wallet.trim(), { strict: false })) {
      setError("Địa chỉ ví phải là địa chỉ 0x… hợp lệ (42 ký tự).");
      return;
    }
    const c = calls();
    if (!c.ok) {
      setError(c.error);
      return;
    }
    const b = parseBook(book);
    if (!b.ok) {
      setError(b.error);
      return;
    }
    setError(null);
    check.mutate({ wallet: getAddress(wallet.trim()), calls: c.value, addressBook: b.value });
  };

  const r = check.data;
  return (
    <>
      <PageHeader title={PAGE.walletCheck}>
        Trước khi ký một giao dịch, xem nó sẽ làm gì với ví của bạn. Không cần két, không gửi gì, không ký gì.
      </PageHeader>

      {demoOff ? (
        <Notice status="warning" title="Chưa thể kiểm tra miễn phí ở đây">
          Dịch vụ này không bật bản thử miễn phí. Ví và ứng dụng gọi <code>/v1/wallet/check</code>, 0,005 USDC
          mỗi lần qua x402.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title="Giao dịch cần ký">
          <div className="flex flex-col gap-4">
            <TextInput
              label="Ví của bạn"
              value={wallet}
              onChange={(v) => {
                setWallet(v);
                edited();
              }}
              mono
              placeholder="0x…"
              description={
                connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto px-0"
                    onPress={() => {
                      setWallet(connected);
                      edited();
                    }}
                  >
                    Dùng ví đang kết nối
                  </Button>
                ) : (
                  "Địa chỉ sẽ ký giao dịch. Chỉ cần địa chỉ, không cần khoá."
                )
              }
            />
            <Tabs
              variant="secondary"
              selectedKey={kind}
              onSelectionChange={(k) => {
                setKind(k as Kind);
                edited();
              }}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="Loại giao dịch">
                  <Tabs.Tab id="cap-quyen">
                    Cấp quyền
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="chuyen">
                    Chuyển tiền
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="tho">
                    Giao dịch thô
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="cap-quyen" className="flex flex-col gap-4 px-0 pt-4 pb-0">
                <TextInput
                  label="Cấp quyền tiêu USDC cho"
                  value={spender}
                  onChange={(v) => {
                    setSpender(v);
                    edited();
                  }}
                  mono
                  placeholder="0x…"
                  description="Địa chỉ trang web hoặc ứng dụng xin quyền tiêu token của bạn."
                />
                <Checkbox
                  isSelected={unlimited}
                  onChange={(v) => {
                    setUnlimited(v);
                    edited();
                  }}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Label>Không giới hạn (như nhiều trang web hay xin)</Label>
                  </Checkbox.Content>
                </Checkbox>
                {!unlimited ? (
                  <TextInput
                    label="Số USDC được phép tiêu"
                    value={approveAmount}
                    onChange={(v) => {
                      setApproveAmount(v);
                      edited();
                    }}
                  />
                ) : null}
              </Tabs.Panel>

              <Tabs.Panel id="chuyen" className="flex flex-col gap-4 px-0 pt-4 pb-0">
                <TextInput
                  label="Người nhận"
                  value={to}
                  onChange={(v) => {
                    setTo(v);
                    edited();
                  }}
                  mono
                  placeholder="0x…"
                />
                <TextInput
                  label="Số tiền (USDC)"
                  value={amount}
                  onChange={(v) => {
                    setAmount(v);
                    edited();
                  }}
                />
              </Tabs.Panel>

              <Tabs.Panel id="tho" className="flex flex-col gap-4 px-0 pt-4 pb-0">
                <TextInput
                  label="Gửi tới (to)"
                  value={rawTo}
                  onChange={(v) => {
                    setRawTo(v);
                    edited();
                  }}
                  mono
                  placeholder="0x…"
                  description="Chép từ màn hình xác nhận của ví hoặc của trang web."
                />
                <TextInput
                  label="Kèm AVAX (value)"
                  value={rawValue}
                  onChange={(v) => {
                    setRawValue(v);
                    edited();
                  }}
                />
                <TextField
                  value={rawData}
                  onChange={(v) => {
                    setRawData(v);
                    edited();
                  }}
                >
                  <Label>Dữ liệu (data)</Label>
                  <TextArea variant="secondary" rows={4} spellCheck={false} className="font-mono text-xs" />
                  <Description>Chuỗi hex bắt đầu bằng 0x mà trang web gửi cho ví.</Description>
                </TextField>
              </Tabs.Panel>
            </Tabs>

            <TextField
              value={book}
              onChange={(v) => {
                setBook(v);
                edited();
              }}
            >
              <Label>Địa chỉ quen (không bắt buộc)</Label>
              <TextArea
                variant="secondary"
                rows={2}
                spellCheck={false}
                placeholder="Mỗi dòng một địa chỉ bạn hay gửi tiền"
                className="font-mono text-xs"
              />
              <Description>
                Để Guardian nhận ra địa chỉ nhái của chúng (giống vài ký tự đầu và cuối).
              </Description>
            </TextField>

            {preview.ok ? (
              <p className="text-sm text-muted">
                Sẽ kiểm tra: {preview.value.map((c) => describeCall(c, knownToken)).join("; ")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button variant="primary" className="self-start" isPending={check.isPending} onPress={run}>
              Kiểm tra (miễn phí)
            </Button>
          </div>
        </Card>

        <Card title="Kết quả">
          {check.isError ? (
            <ErrorBox
              title="Chưa kiểm tra được"
              detail={errorText(check.error)}
              onRetry={() => {
                check.reset();
                run();
              }}
            />
          ) : null}
          {!r && !check.isError ? (
            <p className="text-sm text-muted">
              {check.isPending
                ? retrying
                  ? "Guardian đang nạp dữ liệu cho ví này, đang thử lại…"
                  : "Đang chạy thử giao dịch trên bản sao của Avalanche Fuji…"
                : "Kết quả hiện ở đây: mức rủi ro, lý do, và tiền sẽ ra vào ví bạn ra sao."}
            </p>
          ) : null}
          {r ? (
            <div aria-live="polite" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge risk={r.risk} score={r.score} size="md" />
                <span className="text-xs text-muted">{r.latencyMs} ms · không gửi gì, không ký gì</span>
              </div>
              <RuleChips ids={r.findings.map((f) => f.ruleId)} />
              <p className="text-sm leading-6">{r.explanation.vi}</p>
              {r.diff.tokenDeltas.length || r.diff.nativeDelta !== "0" ? (
                <ul className="flex flex-col divide-y divide-separator rounded-xl bg-surface-secondary text-sm">
                  {r.diff.tokenDeltas.map((d) => (
                    <li key={d.token} className="flex justify-between gap-3 px-3 py-2">
                      <span>{d.symbol}</span>
                      <span
                        className={`tabular-nums ${d.delta.startsWith("-") ? "text-danger" : "text-success-soft-foreground"}`}
                      >
                        {d.delta.startsWith("-") ? "" : "+"}
                        {formatAmount(d.delta, d.decimals, 6)}
                      </span>
                    </li>
                  ))}
                  {r.diff.nativeDelta !== "0" ? (
                    <li className="flex justify-between gap-3 px-3 py-2">
                      <span>AVAX</span>
                      <span className="tabular-nums">{formatAmount(r.diff.nativeDelta, 18, 6)}</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <p className="text-xs text-muted">
                Mức rủi ro do bộ luật cố định quyết định; AI chỉ viết lời giải thích. {r.explanation.en}
              </p>
              <TechDetails>
                <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(r.findings, null, 2)}</pre>
              </TechDetails>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
