"use client";
// The steps of /bat-dau before the vault exists: the owner's wallet, the agent's wallet, the rules, and the
// review that creates the vault in one transaction (VaultFactory.createVault, SPEC §4.10).
import {
  ArrowUpRightFromSquare,
  CircleCheckFill,
  CircleDashed,
  CircleXmarkFill,
  Plus,
  Sparkles,
  TrashBin,
} from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Checkbox } from "@heroui/react/checkbox";
import { Description } from "@heroui/react/description";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { Link } from "@heroui/react/link";
import { NumberField } from "@heroui/react/number-field";
import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { Spinner } from "@heroui/react/spinner";
import { TextField } from "@heroui/react/textfield";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { signInWithWallet, useMe, useRefreshMe } from "@/lib/account";
import { FAUCET, OWNER_GAS_MIN, useBalances } from "@/lib/balances";
import { formatAmount, shortHex } from "@/lib/format";
import {
  checkAgent,
  filledRecipients,
  limitIssues,
  recipientIssues,
  rulesInWords,
  type SetupDraft,
} from "@/lib/setup";
import { CopyButton } from "./connect-agent";
import { errorOf } from "./form";
import { TechDetails, Term } from "./ui";
import { ConnectWalletButton } from "./wallet";

type StepProps = { draft: SetupDraft; setDraft: (d: SetupDraft) => void };

// ------------------------------------------------------------------ shared pieces

/** One requirement of a step: done, to do (with its action) or failed. */
function Check({
  state,
  title,
  detail,
  action,
}: {
  state: "done" | "todo" | "busy" | "bad";
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  const icon =
    state === "done" ? (
      <CircleCheckFill aria-hidden="true" className="size-5 text-success" />
    ) : state === "busy" ? (
      <Spinner size="sm" color="current" />
    ) : state === "bad" ? (
      <CircleXmarkFill aria-hidden="true" className="size-5 text-danger" />
    ) : (
      <CircleDashed aria-hidden="true" className="size-5 text-muted" />
    );
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <span className="grid size-5 place-items-center">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {detail ? <span className="text-sm text-muted">{detail}</span> : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:pl-9">{action}</div>
      ) : null}
    </li>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noreferrer" className="text-sm">
      {children}
      <ArrowUpRightFromSquare aria-hidden="true" className="ml-1 inline size-3" />
    </Link>
  );
}

// ------------------------------------------------------------------ 1. owner wallet

/** Ready when the wallet is connected, on Fuji, linked to the account and has gas. */
export function useOwnerReady() {
  const me = useMe();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const balances = useBalances(address);
  const linked =
    !!address && (me.data?.wallets ?? []).some((w) => w.address.toLowerCase() === address.toLowerCase());
  const onFuji = chainId === avalancheFuji.id;
  const gas = balances.avax !== undefined && balances.avax >= OWNER_GAS_MIN;
  return {
    address,
    isConnected,
    linked,
    onFuji,
    gas,
    balances,
    ready: isConnected && linked && onFuji && gas,
    wallets: (me.data?.wallets ?? []).map((w) => w.address),
  };
}

export function OwnerStep() {
  const o = useOwnerReady();
  const refresh = useRefreshMe();
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: switching } = useSwitchChain();
  const link = useMutation({
    mutationFn: () => signInWithWallet(o.address as Address, signMessageAsync),
    onSuccess: () => refresh(),
  });
  return (
    <ul className="flex flex-col divide-y divide-separator">
      <Check
        state={o.isConnected ? "done" : "todo"}
        title={o.isConnected && o.address ? `Ví ${shortHex(o.address)} đã kết nối` : "Kết nối ví"}
        detail={
          o.isConnected ? null : (
            <>
              Core hoặc MetaMask. Chưa có ví? <ExternalLink href="https://core.app">Cài Core</ExternalLink>
            </>
          )
        }
        action={o.isConnected ? null : <ConnectWalletButton />}
      />
      {o.isConnected ? (
        <Check
          state={o.onFuji ? "done" : "todo"}
          title={o.onFuji ? "Đang ở mạng Avalanche Fuji" : "Chuyển sang mạng Avalanche Fuji"}
          detail="Fuji là mạng thử của Avalanche: tiền ở đây không có giá trị thật."
          action={
            o.onFuji ? null : (
              <Button
                size="sm"
                variant="primary"
                isPending={switching}
                onPress={() => switchChain({ chainId: avalancheFuji.id })}
              >
                Chuyển mạng
              </Button>
            )
          }
        />
      ) : null}
      {o.isConnected ? (
        <Check
          state={o.linked ? "done" : link.isPending ? "busy" : link.isError ? "bad" : "todo"}
          title={o.linked ? "Ví đã thuộc tài khoản của bạn" : "Xác nhận ví thuộc tài khoản này"}
          detail={
            link.isError
              ? errorOf(link.error).split("\n")[0]
              : o.linked
                ? null
                : "Ký một thông điệp miễn phí, không phải giao dịch."
          }
          action={
            o.linked ? null : (
              <Button size="sm" variant="primary" isPending={link.isPending} onPress={() => link.mutate()}>
                Ký xác nhận
              </Button>
            )
          }
        />
      ) : null}
      {o.isConnected ? (
        <Check
          state={o.balances.avax === undefined ? "busy" : o.gas ? "done" : "todo"}
          title={
            <>
              <Term tip="AVAX trả phí mạng cho mỗi giao dịch, như tem thư. Tạo két tốn khoảng 0,01 AVAX.">
                AVAX trả phí mạng
              </Term>
              {o.balances.avax !== undefined ? (
                <span className="ml-2 font-normal text-muted tabular-nums">
                  {formatAmount(o.balances.avax, 18, 4)} AVAX
                </span>
              ) : null}
            </>
          }
          detail={o.gas ? null : `Cần ít nhất ${formatUnits(OWNER_GAS_MIN, 18)} AVAX.`}
          action={
            o.gas ? null : (
              <>
                <ExternalLink href={FAUCET.avax}>Lấy AVAX miễn phí</ExternalLink>
                <Button size="sm" variant="ghost" onPress={o.balances.refetch}>
                  Kiểm tra lại
                </Button>
              </>
            )
          }
        />
      ) : null}
      {o.isConnected ? (
        <Check
          state={o.balances.usdc === undefined ? "busy" : (o.balances.usdc ?? 0n) > 0n ? "done" : "todo"}
          title={
            <>
              USDC để nạp vào két
              {o.balances.usdc !== undefined ? (
                <span className="ml-2 font-normal text-muted tabular-nums">
                  {formatAmount(o.balances.usdc, 6, 2)} USDC
                </span>
              ) : null}
            </>
          }
          detail={(o.balances.usdc ?? 0n) > 0n ? null : "Chưa cần ngay: bạn nạp ở bước 5."}
          action={
            (o.balances.usdc ?? 0n) > 0n ? null : (
              <ExternalLink href={FAUCET.usdc}>Lấy USDC miễn phí</ExternalLink>
            )
          }
        />
      ) : null}
    </ul>
  );
}

// ------------------------------------------------------------------ 2. agent

export function AgentStep({
  draft,
  setDraft,
  generatedPk,
  setGeneratedPk,
  ownerWallets,
  savedKey,
  setSavedKey,
}: StepProps & {
  generatedPk: Hex | null;
  setGeneratedPk: (pk: Hex | null) => void;
  ownerWallets: string[];
  savedKey: boolean;
  setSavedKey: (v: boolean) => void;
}) {
  const [touched, setTouched] = useState(false);
  const check = checkAgent(draft.agentAddress, ownerWallets);
  const showError = touched && !check.ok;
  return (
    <div className="flex flex-col gap-6">
      <TextField
        value={draft.agentName}
        onChange={(v) => setDraft({ ...draft, agentName: v })}
        maxLength={60}
        isRequired
      >
        <Label>Tên agent</Label>
        <Input placeholder="Ví dụ: Agent mua hàng" />
        <Description>Chỉ để bạn nhận ra agent trong dashboard.</Description>
      </TextField>

      <div className="flex flex-col gap-3">
        <TextField
          value={draft.agentAddress}
          onChange={(v) => {
            setGeneratedPk(null);
            setDraft({ ...draft, agentAddress: v });
          }}
          onBlur={() => setTouched(true)}
          isInvalid={showError}
          isRequired
        >
          <Label>Địa chỉ ví của agent</Label>
          <Input placeholder="0x…" className="font-mono" spellCheck={false} />
          <Description>
            Agent dùng ví riêng để ký giao dịch và trả phí Guardian. Két không bao giờ giữ khoá của ví này.
          </Description>
          <FieldError>{!check.ok ? check.message : null}</FieldError>
        </TextField>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="tertiary"
            onPress={() => {
              const pk = generatePrivateKey();
              setGeneratedPk(pk);
              setSavedKey(false);
              setDraft({ ...draft, agentAddress: privateKeyToAccount(pk).address });
            }}
          >
            <Sparkles aria-hidden="true" />
            {generatedPk ? "Tạo ví khác" : "Chưa có ví? Tạo ví mới cho agent"}
          </Button>
        </div>
      </div>

      {generatedPk ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft/40 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Khoá riêng của ví agent</span>
            <span className="text-sm text-muted">
              Tạo ngay trong trình duyệt, không gửi đi đâu. Ai có khoá này điều khiển được ví agent, nên chỉ
              đặt nó vào máy chạy agent. Bước 6 sẽ điền sẵn nó vào cấu hình MCP.
            </span>
          </div>
          <code className="rounded-lg bg-surface px-3 py-2 font-mono text-xs break-all">{generatedPk}</code>
          <div className="flex flex-wrap items-center gap-4">
            <CopyButton value={generatedPk} label="Chép khoá" />
            <Checkbox isSelected={savedKey} onChange={setSavedKey}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                Tôi đã lưu khoá này
              </Checkbox.Content>
            </Checkbox>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const agentStepReady = (
  draft: SetupDraft,
  ownerWallets: string[],
  generatedPk: Hex | null,
  savedKey: boolean,
) =>
  draft.agentName.trim().length > 0 &&
  checkAgent(draft.agentAddress, ownerWallets).ok &&
  (!generatedPk || savedKey);

// ------------------------------------------------------------------ 3. rules

function UsdcField({
  label,
  description,
  value,
  onChange,
  error,
  allowZero,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (n: number) => void;
  error?: string | undefined;
  allowZero?: boolean;
}) {
  return (
    <NumberField
      value={value}
      onChange={(n) => onChange(Number.isNaN(n) ? 0 : n)}
      minValue={0}
      step={1}
      formatOptions={{ maximumFractionDigits: 2 }}
      isInvalid={Boolean(error)}
    >
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input />
        <NumberField.IncrementButton />
      </NumberField.Group>
      <Description>{allowZero && value === 0 ? "0 = không giới hạn." : description}</Description>
      <FieldError>{error}</FieldError>
    </NumberField>
  );
}

export function RulesStep({ draft, setDraft }: StepProps) {
  const [showErrors, setShowErrors] = useState(false);
  const recIssues = recipientIssues(draft.recipients, draft.agentAddress);
  const issuesAt = (i: number, field: "name" | "address") =>
    showErrors ? recIssues.find((x) => x.index === i && x.field === field)?.message : undefined;
  const lim = limitIssues(draft);
  const limitError = (f: "dailyCap" | "maxPerTx" | "budget") => lim.find((x) => x.field === f)?.message;
  const setRecipient = (i: number, patch: Partial<{ name: string; address: string }>) =>
    setDraft({
      ...draft,
      recipients: draft.recipients.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="nguoi-nhan" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="nguoi-nhan" className="text-heading">
              Agent được trả tiền cho ai?
            </h3>
            <p className="text-sm text-muted">Địa chỉ ngoài danh sách này luôn bị két từ chối.</p>
          </div>
          <ul className="flex flex-col gap-3">
            {draft.recipients.map((r, i) => (
              <li key={i} className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-start">
                <TextField
                  value={r.name}
                  onChange={(v) => setRecipient(i, { name: v })}
                  maxLength={60}
                  isInvalid={Boolean(issuesAt(i, "name"))}
                  aria-label={`Tên người nhận ${i + 1}`}
                >
                  <Input placeholder="Tên người nhận" />
                  <FieldError>{issuesAt(i, "name")}</FieldError>
                </TextField>
                <TextField
                  value={r.address}
                  onChange={(v) => setRecipient(i, { address: v })}
                  onBlur={() => setShowErrors(true)}
                  isInvalid={Boolean(issuesAt(i, "address"))}
                  aria-label={`Địa chỉ người nhận ${i + 1}`}
                >
                  <Input placeholder="Địa chỉ ví 0x…" className="font-mono" spellCheck={false} />
                  <FieldError>{issuesAt(i, "address")}</FieldError>
                </TextField>
                <Button
                  isIconOnly
                  variant="ghost"
                  aria-label={`Bỏ người nhận ${i + 1}`}
                  isDisabled={draft.recipients.length === 1}
                  onPress={() =>
                    setDraft({ ...draft, recipients: draft.recipients.filter((_, j) => j !== i) })
                  }
                >
                  <TrashBin aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="tertiary"
              size="sm"
              isDisabled={draft.recipients.length >= 10}
              onPress={() =>
                setDraft({ ...draft, recipients: [...draft.recipients, { name: "", address: "" }] })
              }
            >
              <Plus aria-hidden="true" />
              Thêm người nhận
            </Button>
          </div>
        </section>

        <section aria-labelledby="han-muc" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="han-muc" className="text-heading">
              Agent được tiêu bao nhiêu?
            </h3>
            <p className="text-sm text-muted">
              Tính bằng USDC. Vượt bất kỳ mức nào, két từ chối cả giao dịch.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <UsdcField
              label="Mỗi ngày"
              description="Làm mới lúc 07:00 hằng ngày."
              value={draft.dailyCap}
              onChange={(n) => setDraft({ ...draft, dailyCap: n })}
              error={limitError("dailyCap")}
            />
            <UsdcField
              label="Mỗi giao dịch"
              description="Một lần chi không quá mức này."
              value={draft.maxPerTx}
              onChange={(n) => setDraft({ ...draft, maxPerTx: n })}
              error={limitError("maxPerTx")}
              allowZero
            />
            <UsdcField
              label="Tổng cộng"
              description="Hết thì agent dừng tới khi bạn làm mới."
              value={draft.budget}
              onChange={(n) => setDraft({ ...draft, budget: n })}
              error={limitError("budget")}
              allowZero
            />
          </div>
        </section>

        <section aria-labelledby="rui-ro" className="flex flex-col gap-3">
          <RadioGroup
            value={String(draft.maxRisk)}
            onChange={(v) => setDraft({ ...draft, maxRisk: v === "1" ? 1 : 0 })}
            variant="secondary"
          >
            <Label id="rui-ro" className="text-heading">
              Guardian được duyệt tới mức rủi ro nào?
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  value: "0",
                  title: "Thận trọng",
                  text: "Chỉ khoản chi rủi ro thấp. Nên chọn khi mới bắt đầu.",
                },
                {
                  value: "1",
                  title: "Cân bằng",
                  text: "Cho cả rủi ro trung bình, ví dụ người nhận mới hoặc số tiền lớn bất thường.",
                },
              ].map((o) => (
                <Radio key={o.value} value={o.value}>
                  <Radio.Content className="relative flex h-full w-full flex-col items-start gap-1 rounded-xl text-left border border-border bg-surface px-4 py-3 pr-10 transition-colors data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft">
                    <Radio.Control className="absolute top-3 right-3 size-5">
                      <Radio.Indicator />
                    </Radio.Control>
                    <span className="text-sm font-semibold">{o.title}</span>
                    <Description>{o.text}</Description>
                  </Radio.Content>
                </Radio>
              ))}
            </div>
          </RadioGroup>
        </section>
      </div>

      <aside
        aria-label="Agent sẽ hiểu như sau"
        className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start"
      >
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-secondary p-5">
          <span className="text-sm font-semibold">Agent sẽ đọc được như sau</span>
          <ul className="flex flex-col gap-2.5 text-sm">
            {rulesInWords(draft).map((s) => (
              <li key={s} className="flex gap-2">
                <CircleCheckFill aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Két kiểm tra các quy tắc này trên blockchain. Agent, kể cả bị lừa, cũng không vượt qua được.
          </p>
        </div>
      </aside>
    </div>
  );
}

export const rulesStepReady = (d: SetupDraft) =>
  recipientIssues(d.recipients, d.agentAddress).length === 0 && limitIssues(d).length === 0;

// ------------------------------------------------------------------ 4. review

export function ReviewSummary({
  draft,
  owner,
  guardian,
}: {
  draft: SetupDraft;
  owner: string | undefined;
  guardian: string | undefined;
}) {
  const recipients = filledRecipients(draft.recipients);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
        <dt className="text-muted">Chủ két</dt>
        <dd className="font-mono text-xs break-all">{owner ?? "…"}</dd>
        <dt className="text-muted">Agent</dt>
        <dd className="flex min-w-0 flex-col">
          <span className="font-medium">{draft.agentName || "—"}</span>
          <span className={`text-xs break-all text-muted ${draft.agentAddress ? "font-mono" : ""}`}>
            {draft.agentAddress || "Chưa có địa chỉ"}
          </span>
        </dd>
        <dt className="text-muted">Người nhận</dt>
        <dd className="flex min-w-0 flex-col gap-1">
          {recipients.length === 0 ? <span className="text-muted">Chưa có</span> : null}
          {recipients.map((r) => (
            <span key={r.address} className="flex min-w-0 flex-wrap gap-x-2">
              <span className="font-medium">{r.name}</span>
              <span className="font-mono text-xs text-muted">{shortHex(r.address)}</span>
            </span>
          ))}
        </dd>
        <dt className="text-muted">Quy tắc</dt>
        <dd>
          <ul className="flex flex-col gap-1">
            {rulesInWords(draft)
              .slice(1)
              .map((s) => (
                <li key={s}>{s}</li>
              ))}
          </ul>
        </dd>
        <dt className="text-muted">Guardian ký duyệt</dt>
        <dd className="font-mono text-xs break-all">{guardian ?? "Đang hỏi Guardian…"}</dd>
        <dt className="text-muted">Phí</dt>
        <dd>Khoảng 0,01 AVAX phí mạng. Guardian402 không thu phí tạo két.</dd>
      </dl>
      <TechDetails>
        <span>
          Gọi <code className="font-mono">VaultFactory.createVault(agent, guardian, config)</code>: tạo một
          AgentVault mới, chủ là ví của bạn, người ký duyệt là Guardian của dashboard này. Factory không giữ
          quyền gì với két.
        </span>
      </TechDetails>
    </div>
  );
}
