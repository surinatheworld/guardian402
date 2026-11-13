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
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
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
