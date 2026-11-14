"use client";
// Money in: the owner deposits USDC into the vault (what the agent may spend), and tops up the agent's own
// wallet (gas in AVAX for its transactions, a little USDC for the Guardian's fees). Both are plain transfers
// from the owner's wallet; the vault needs no deposit function (SPEC §4.10).
import { ArrowUpRightFromSquare } from "@gravity-ui/icons";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Label } from "@heroui/react/label";
import { Link } from "@heroui/react/link";
import { NumberField } from "@heroui/react/number-field";
import { useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useSendTransaction, useWriteContract } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { AGENT_FEE_AVAX, AGENT_FEE_USDC, FAUCET, useBalances } from "@/lib/balances";
import { deployment } from "@/lib/config";
import { formatAmount, fromUnits } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { TxStatus } from "./tx-status";
import { ConnectWalletButton } from "./wallet";

const usdcText = (raw: bigint | undefined) => (raw === undefined ? "…" : `${formatAmount(raw, 6, 2)} USDC`);
const avaxText = (raw: bigint | undefined) => (raw === undefined ? "…" : `${formatAmount(raw, 18, 4)} AVAX`);

function FaucetLink({ token }: { token: "avax" | "usdc" }) {
  return (
    <Link href={FAUCET[token]} target="_blank" rel="noreferrer" className="text-sm">
      Lấy {token === "avax" ? "AVAX" : "USDC"} thử nghiệm miễn phí
      <ArrowUpRightFromSquare aria-hidden="true" className="ml-1 inline size-3" />
    </Link>
  );
}

/** USDC from the owner's wallet into the vault. */
export function DepositForm({ vault, onDone }: { vault: Address; onDone?: () => void }) {
  const { address, isConnected } = useAccount();
  const wallet = useBalances(address);
  const inVault = useBalances(vault);
  // Start from what the wallet can actually send (at most 20), so the field never opens in an error state.
  const [amount, setAmount] = useState<number | null>(null);
  const suggested = wallet.usdc === undefined ? 20 : Math.min(20, Math.floor(fromUnits(wallet.usdc, 6)));
  const value = amount ?? suggested;
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  if (!isConnected || !address)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">Kết nối ví chủ để nạp.</p>
        <ConnectWalletButton />
      </div>
    );
  const raw = Number.isFinite(value) && value > 0 ? parseUnits(String(value), 6) : 0n;
  const tooMuch = wallet.usdc !== undefined && raw > wallet.usdc;
  const empty = wallet.usdc === 0n;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
          <dt className="text-muted">Ví của bạn</dt>
          <dd className="font-semibold tabular-nums">{usdcText(wallet.usdc)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
          <dt className="text-muted">Trong két</dt>
          <dd className="font-semibold tabular-nums">{usdcText(inVault.usdc)}</dd>
        </div>
      </dl>
      {empty ? (
        <p className="text-sm text-muted">
          Ví chưa có USDC. <FaucetLink token="usdc" />, chọn mạng Avalanche Fuji và dán địa chỉ ví của bạn.
        </p>
      ) : null}
      <NumberField
        variant="secondary"
        value={value}
        onChange={setAmount}
        minValue={0}
        step={1}
        formatOptions={{ maximumFractionDigits: 6 }}
        isInvalid={tooMuch}
        isDisabled={tx.busy || tx.phase.step === "unknown" || empty}
      >
        <Label>Số USDC nạp vào két</Label>
        <NumberField.Group>
          <NumberField.DecrementButton aria-label="Giảm" />
          <NumberField.Input />
          <NumberField.IncrementButton aria-label="Tăng" />
        </NumberField.Group>
        {tooMuch ? <Description>Nhiều hơn số dư ví của bạn.</Description> : null}
      </NumberField>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          isDisabled={raw === 0n || tooMuch || tx.phase.step === "unknown"}
          isPending={tx.busy}
          onPress={async () => {
            const r = await tx.run(() =>
              writeContractAsync({
                address: deployment.usdc,
                abi: erc20Abi,
                functionName: "transfer",
                args: [vault, raw],
                chainId: avalancheFuji.id,
              }),
            );
            if (r) onDone?.();
          }}
        >
          {tx.phase.step === "failed" ? "Thử lại" : "Nạp vào két"}
        </Button>
      </div>
      <TxStatus
        phase={tx.phase}
        done={`Đã nạp ${formatUnits(raw, 6)} USDC vào két`}
        onCheck={() => void tx.checkStatus().then((r) => r && onDone?.())}
      />
    </div>
  );
}

/** Gas (AVAX) and Guardian fees (USDC) from the owner's wallet to the agent's wallet. */
export function AgentFeeForm({ agent, onDone }: { agent: Address; onDone?: () => void }) {
  const { address, isConnected } = useAccount();
  const wallet = useBalances(address);
  const agentBalances = useBalances(agent);
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const gasTx = useTx();
  const feeTx = useTx();
  if (!isConnected || !address)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">Kết nối ví chủ để gửi.</p>
        <ConnectWalletButton />
      </div>
    );
  const needGas = agentBalances.avax !== undefined && agentBalances.avax < AGENT_FEE_AVAX / 2n;
  const needFee = agentBalances.usdc !== undefined && agentBalances.usdc < AGENT_FEE_USDC / 2n;
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-separator rounded-xl bg-surface-secondary">
        <li className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Phí mạng (AVAX)</span>
            <span className="text-xs text-muted tabular-nums">
              Agent đang có {avaxText(agentBalances.avax)} · mỗi giao dịch tốn khoảng 0,001
            </span>
          </div>
          <Button
            size="sm"
            variant={needGas ? "primary" : "tertiary"}
            isPending={gasTx.busy}
            isDisabled={
              gasTx.phase.step === "unknown" || (wallet.avax !== undefined && wallet.avax < AGENT_FEE_AVAX)
            }
            onPress={() =>
              gasTx
                .run(() =>
                  sendTransactionAsync({ to: agent, value: AGENT_FEE_AVAX, chainId: avalancheFuji.id }),
                )
                .then((r) => r && onDone?.())
            }
          >
            Gửi {formatUnits(AGENT_FEE_AVAX, 18)} AVAX
          </Button>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Phí Guardian (USDC)</span>
            <span className="text-xs text-muted tabular-nums">
              Agent đang có {usdcText(agentBalances.usdc)} · mỗi lần duyệt 0,01 USDC
            </span>
          </div>
          <Button
            size="sm"
            variant={needFee ? "primary" : "tertiary"}
            isPending={feeTx.busy}
            isDisabled={
              feeTx.phase.step === "unknown" || (wallet.usdc !== undefined && wallet.usdc < AGENT_FEE_USDC)
            }
            onPress={() =>
              feeTx
                .run(() =>
                  writeContractAsync({
                    address: deployment.usdc,
                    abi: erc20Abi,
                    functionName: "transfer",
                    args: [agent, AGENT_FEE_USDC],
                    chainId: avalancheFuji.id,
                  }),
                )
                .then((r) => r && onDone?.())
            }
          >
            Gửi {formatUnits(AGENT_FEE_USDC, 6)} USDC
          </Button>
        </li>
      </ul>
      <TxStatus
        phase={gasTx.phase}
        done="Đã gửi AVAX cho agent"
        onCheck={() => void gasTx.checkStatus().then((r) => r && onDone?.())}
      />
      <TxStatus
        phase={feeTx.phase}
        done="Đã gửi USDC cho agent"
        onCheck={() => void feeTx.checkStatus().then((r) => r && onDone?.())}
      />
      {wallet.avax !== undefined && wallet.avax < AGENT_FEE_AVAX ? (
        <p className="text-sm text-muted">
          Ví của bạn không đủ AVAX. <FaucetLink token="avax" />
        </p>
      ) : null}
    </div>
  );
}

/** What one press of "Nạp tất cả" sends: the deposit, then the agent's fees when its wallet is low. */
export function fundingPlan(p: {
  deposit: bigint;
  agentAvax: bigint | undefined;
  agentUsdc: bigint | undefined;
}): ("deposit" | "gas" | "fee")[] {
  const plan: ("deposit" | "gas" | "fee")[] = [];
  if (p.deposit > 0n) plan.push("deposit");
  if (p.agentAvax !== undefined && p.agentAvax < AGENT_FEE_AVAX / 2n) plan.push("gas");
  if (p.agentUsdc !== undefined && p.agentUsdc < AGENT_FEE_USDC / 2n) plan.push("fee");
  return plan;
}

const STEP_LABEL = {
  deposit: (raw: bigint) => `Nạp ${formatUnits(raw, 6)} USDC vào két`,
  gas: () => `Gửi ${formatUnits(AGENT_FEE_AVAX, 18)} AVAX phí mạng cho ví agent`,
  fee: () => `Gửi ${formatUnits(AGENT_FEE_USDC, 6)} USDC phí Guardian cho ví agent`,
} as const;

/**
 * The deposit and the agent's fees in one press (step 5 of /bat-dau): each is still its own transaction the owner
 * signs in the wallet, sent one after the other, and a refusal stops the rest.
 */
export function FundAllForm({
  vault,
  agent,
  onDone,
}: {
  vault: Address;
  agent: Address;
  onDone?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const wallet = useBalances(address);
  const inVault = useBalances(vault);
  const agentBalances = useBalances(agent);
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const txs = { deposit: useTx(), gas: useTx(), fee: useTx() };
  const [running, setRunning] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);

  if (!isConnected || !address)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">Kết nối ví chủ để nạp.</p>
        <ConnectWalletButton />
      </div>
    );

  const agentNeedsFee = agentBalances.usdc !== undefined && agentBalances.usdc < AGENT_FEE_USDC / 2n;
  const spendable =
    wallet.usdc === undefined ? undefined : wallet.usdc - (agentNeedsFee ? AGENT_FEE_USDC : 0n);
  const suggested =
    spendable === undefined ? 10 : Math.max(0, Math.min(10, Math.floor(fromUnits(spendable, 6))));
  const value = amount ?? suggested;
  const raw = Number.isFinite(value) && value > 0 ? parseUnits(String(value), 6) : 0n;
  const plan = fundingPlan({ deposit: raw, agentAvax: agentBalances.avax, agentUsdc: agentBalances.usdc });
  const usdcNeeded = raw + (plan.includes("fee") ? AGENT_FEE_USDC : 0n);
  const avaxNeeded = plan.includes("gas") ? AGENT_FEE_AVAX : 0n;
  const short =
    wallet.usdc !== undefined && usdcNeeded > wallet.usdc
      ? "Ví không đủ USDC cho tất cả các khoản."
      : wallet.avax !== undefined && avaxNeeded + AGENT_FEE_AVAX / 10n > wallet.avax
        ? "Ví không đủ AVAX cho phí agent và phí mạng."
        : null;
  const allDone = plan.length > 0 && plan.every((s) => txs[s].phase.step === "done");

  async function runAll() {
    setRunning(true);
    for (const step of plan) {
      if (txs[step].phase.step === "done") continue;
      const r = await txs[step].run(() =>
        step === "gas"
          ? sendTransactionAsync({ to: agent, value: AGENT_FEE_AVAX, chainId: avalancheFuji.id })
          : writeContractAsync({
              address: deployment.usdc,
              abi: erc20Abi,
              functionName: "transfer",
              args: step === "deposit" ? [vault, raw] : [agent, AGENT_FEE_USDC],
              chainId: avalancheFuji.id,
            }),
      );
      if (!r) break; // refused or failed: stop, the owner sees why on that line
    }
    setRunning(false);
    onDone?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
          <dt className="text-muted">Ví của bạn</dt>
          <dd className="font-semibold tabular-nums">{usdcText(wallet.usdc)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
          <dt className="text-muted">Trong két</dt>
          <dd className="font-semibold tabular-nums">{usdcText(inVault.usdc)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary p-3">
          <dt className="text-muted">Ví agent</dt>
          <dd className="font-semibold tabular-nums">
            {avaxText(agentBalances.avax)} · {usdcText(agentBalances.usdc)}
          </dd>
        </div>
      </dl>
      {wallet.usdc === 0n ? (
        <p className="text-sm text-muted">
          Ví chưa có USDC. <FaucetLink token="usdc" />, chọn mạng Avalanche Fuji và dán địa chỉ ví của bạn.
        </p>
      ) : null}
      <NumberField
        variant="secondary"
        value={value}
        onChange={setAmount}
        minValue={0}
        step={1}
        formatOptions={{ maximumFractionDigits: 6 }}
        isDisabled={running || allDone}
      >
        <Label>Số USDC nạp vào két</Label>
        <NumberField.Group>
          <NumberField.DecrementButton aria-label="Giảm" />
          <NumberField.Input />
          <NumberField.IncrementButton aria-label="Tăng" />
        </NumberField.Group>
        <Description>Agent chỉ tiêu được tiền trong két, theo quy tắc của két.</Description>
      </NumberField>

      {plan.length ? (
        <ol aria-label="Các khoản sẽ gửi" className="flex flex-col gap-2 text-sm">
          {plan.map((step, i) => (
            <li key={step} className="flex flex-col gap-1 rounded-xl bg-surface-secondary p-3">
              <span className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                {STEP_LABEL[step](raw)}
              </span>
              <TxStatus phase={txs[step].phase} done="Xong" onCheck={() => void txs[step].checkStatus()} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Két đã có tiền và ví agent đã đủ phí.</p>
      )}
      {short ? <p className="text-sm text-danger">{short}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          isDisabled={!plan.length || Boolean(short) || allDone}
          isPending={running}
          onPress={() => void runAll()}
        >
          {allDone ? "Đã nạp xong" : plan.length > 1 ? `Nạp tất cả (${plan.length} lần ký trong ví)` : "Nạp"}
        </Button>
      </div>
    </div>
  );
}
