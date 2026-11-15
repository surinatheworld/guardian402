"use client";
// The agent's `pay`, run in the owner's browser so the owner can try the whole flow with one button and nothing
// to install. Same steps as the MCP tool (apps/guardian-mcp/src/agent-tools.ts): a free dry run of the vault's
// executeBatch without a verdict first (a payment the vault refuses costs nothing; a small one it allows without
// approval goes straight out, no Guardian fee); only when the vault asks for approval, the Guardian checks and
// approves the payment (its 0.01 USDC fee paid over x402 by the agent wallet), the risk is compared with the
// vault's maximum, the vault's executeBatch is simulated again, and only then the agent wallet sends it.
//
// Non-custodial: the agent wallet key lives in this tab's memory only. It is never sent to the dashboard or the
// Guardian; the x402 payment and the transaction are signed here.
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentVaultAbi,
  checkResponseSchema,
  FUJI_CAIP2,
  fujiChain,
  rpcTransport,
  USDC_FUJI,
  type Call,
  type CheckResponse,
} from "@guardian402/shared";
import { GUARDIAN_URL, RPC_URL } from "./config";

/** The x402 client refuses any Guardian fee above this (0.02 USDC), as the MCP server does. */
const MAX_FEE_ATOMIC = "20000";
const RISK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

/** `check` is absent when the vault ran the payment without the Guardian (at most its verdict threshold). */
export type WebPayResult =
  | { outcome: "paid"; tx: Hex; check?: CheckResponse | undefined; feeTx?: Hex | undefined }
  | { outcome: "reverted"; tx: Hex; check?: CheckResponse | undefined; feeTx?: Hex | undefined }
  | {
      outcome: "blocked";
      by: "vault-state" | "guardian" | "vault";
      reason: string;
      check?: CheckResponse | undefined;
      feeTx?: Hex | undefined;
    }
  | { outcome: "error"; message: string };

/**
 * A private key as typed or pasted: wallets such as MetaMask export it without the 0x prefix, so both forms are
 * accepted. Returns the 0x form, or null when it is not 32 bytes of hex.
 */
export function toAgentKey(v: string): Hex | null {
  const raw = v.trim();
  const key = /^0x/i.test(raw) ? `0x${raw.slice(2)}` : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
}

export const isAgentKey = (v: string) => toAgentKey(v) !== null;

/** A vault error name in Vietnamese, for the owner. */
export function vaultReasonVi(error: string): string {
  const reasons: Record<string, string> = {
    Paused: "Chủ két đang khoá két.",
    NotAgent: "Ví này không phải ví agent của két.",
    RecipientNotAllowed: "Người nhận không nằm trong danh sách chủ két cho phép.",
    TargetNotAllowed: "Két không cho gọi ứng dụng này.",
    SelectorNotAllowed: "Két không cho gọi chức năng này của ứng dụng.",
    ApprovalTooLarge: "Mức cấp quyền lớn hơn chủ két cho phép.",
    TxCapExceeded: "Vượt hạn mức mỗi giao dịch.",
    DailyCapExceeded: "Vượt phần hạn mức còn lại của hôm nay.",
    BudgetExceeded: "Đã dùng hết tổng ngân sách; chủ két cần làm mới.",
    RiskTooHigh: "Mức rủi ro vượt mức két chấp nhận.",
    VerdictExpired: "Phê duyệt của Guardian đã hết hạn; thử lại.",
    InvalidVerdict: "Phê duyệt không khớp giao dịch này hoặc đã được dùng; két không nhận.",
    BadSignature: "Phê duyệt không do Guardian của két ký.",
    VerdictRequired: "Khoản này cần phê duyệt của Guardian.",
    BadBatch: "Giao dịch rỗng hoặc quá 8 bước.",
  };
  return reasons[error] ?? `Két sẽ từ chối (${error}).`;
}

/** The vault error name a failed call reverted with (or the RPC message). */
export function revertName(e: unknown): string {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  return r instanceof ContractFunctionRevertedError
    ? (r.data?.errorName ?? r.reason ?? "unknown")
    : ((e as BaseError).shortMessage ?? String(e));
}

const NO_VERDICT = {
  callsHash: `0x${"0".repeat(64)}` as Hex,
  nonce: 0n,
  deadline: 0n,
  risk: 0,
  checkId: `0x${"0".repeat(64)}` as Hex,
};

/** The agent wallet address for a key, or null when the key is not a valid private key. */
export function agentAddressOf(key: string): Address | null {
  try {
    const k = toAgentKey(key);
    return k ? privateKeyToAccount(k).address : null;
  } catch {
    return null;
  }
}

/** One USDC transfer from the vault, as the vault batch the Guardian checks. */
export function usdcTransfer(to: Address, amount: string): Call[] {
  return [
    {
      target: USDC_FUJI.address,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, parseUnits(amount, 6)],
      }),
    },
  ];
}

export type WebPayInput = {
  agentKey: Hex;
  vault: Address;
  calls: Call[];
  /** The vault's maxAgentRisk (0 LOW, 1 MEDIUM, 2 HIGH). */
  maxRisk: number;
  paused: boolean;
  /** The vault's agent() on chain: the key must be that wallet's. */
  vaultAgent: Address;
};

/** Check, approve and execute one payment, or stop before sending anything. Never throws. */
export async function webPay(p: WebPayInput): Promise<WebPayResult> {
  try {
    const account = privateKeyToAccount(p.agentKey);
    if (p.paused) return { outcome: "blocked", by: "vault-state", reason: "Chủ két đang khoá két." };
    if (account.address.toLowerCase() !== p.vaultAgent.toLowerCase())
      return {
        outcome: "blocked",
        by: "vault-state",
        reason: `Khoá này là của ví ${account.address}, không phải ví agent của két.`,
      };

    const chain = createPublicClient({ chain: fujiChain, transport: rpcTransport(RPC_URL) });
    const wallet = createWalletClient({ account, chain: fujiChain, transport: rpcTransport(RPC_URL) });

    // 1. Free: would the vault run this without the Guardian? (a read, no gas, no fee)
    const dryArgs = [p.calls, NO_VERDICT, "0x"] as const;
    let dry: string | null = null;
    try {
      await chain.simulateContract({
        account,
        address: p.vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args: dryArgs,
      });
    } catch (e) {
      dry = revertName(e);
    }
    if (dry === null) {
      const tx = await wallet.writeContract({
        address: p.vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args: dryArgs,
      });
      const mined = await chain.waitForTransactionReceipt({ hash: tx });
      return { outcome: mined.status === "success" ? "paid" : "reverted", tx };
    }
    if (dry !== "VerdictRequired") return { outcome: "blocked", by: "vault", reason: vaultReasonVi(dry) };

    // 2. The vault asks for the Guardian's approval.

    const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(account) }],
      spendControls: {
        allowedAssets: [
          { network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: MAX_FEE_ATOMIC },
        ],
      },
    });
    const body = JSON.stringify({
      chainId: fujiChain.id,
      vault: p.vault,
      calls: p.calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
      lang: "vi",
    });
    // A 503 is the Guardian catching up (busy, or its fork refreshing): not charged, ask again shortly.
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await payingFetch(`${GUARDIAN_URL}/v1/cosign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.status !== 503 || attempt >= 2) break;
      await res.body?.cancel();
      const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    const header = res.headers.get("PAYMENT-RESPONSE");
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    const feeTx = receipt?.success && receipt.transaction ? (receipt.transaction as Hex) : undefined;
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok)
      return { outcome: "error", message: json.message ?? json.error ?? `Guardian: HTTP ${res.status}` };
    const check = checkResponseSchema.parse(json);

    if (!check.verdict || RISK[check.risk] > p.maxRisk)
      return {
        outcome: "blocked",
        by: "guardian",
        reason: check.explanation.vi || "Rủi ro vượt mức két chấp nhận.",
        check,
        feeTx,
      };

    const v = check.verdict;
    const args = [
      p.calls,
      {
        callsHash: v.callsHash,
        nonce: BigInt(v.nonce),
        deadline: BigInt(v.deadline),
        risk: v.risk,
        checkId: v.checkId,
      },
      v.signature,
    ] as const;
    try {
      await chain.simulateContract({
        account,
        address: p.vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args,
      });
    } catch (e) {
      return { outcome: "blocked", by: "vault", reason: vaultReasonVi(revertName(e)), check, feeTx };
    }
    const tx = await wallet.writeContract({
      address: p.vault,
      abi: agentVaultAbi,
      functionName: "executeBatch",
      args,
    });
    const mined = await chain.waitForTransactionReceipt({ hash: tx });
    return mined.status === "success"
      ? { outcome: "paid", tx, check, feeTx }
      : { outcome: "reverted", tx, check, feeTx };
  } catch (e) {
    return { outcome: "error", message: (e as BaseError).shortMessage ?? (e as Error).message ?? String(e) };
  }
}
