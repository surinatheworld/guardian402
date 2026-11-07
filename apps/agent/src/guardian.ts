// The agent pays the Guardian per request over x402 (docs/SPEC.md §10). spendControls is the limit the agent
// cannot talk itself out of: only Fuji USDC, at most 0.02 USDC per payment.
import type { Address, Hex, LocalAccount } from "viem";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  checkResponseSchema,
  FUJI_CAIP2,
  USDC_FUJI,
  type Call,
  type CheckResponse,
} from "@guardian402/shared";

export const MAX_PAYMENT_ATOMIC = "20000"; // 0.02 USDC

export function payingFetchFor(agent: LocalAccount) {
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(agent) }],
    spendControls: {
      allowedAssets: [
        { network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: MAX_PAYMENT_ATOMIC },
      ],
    },
  });
}

export type GuardianResult = {
  endpoint: "check" | "cosign";
  status: number;
  response?: CheckResponse;
  paymentTx?: Hex;
  error?: string;
};

export async function askGuardian(
  payingFetch: ReturnType<typeof payingFetchFor>,
  guardianUrl: string,
  endpoint: "check" | "cosign",
  vault: Address,
  calls: Call[],
): Promise<GuardianResult> {
  const body = {
    chainId: 43113,
    vault,
    calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
  };
  const res = await payingFetch(`${guardianUrl}/v1/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const header = res.headers.get("PAYMENT-RESPONSE");
  const receipt = header ? decodePaymentResponseHeader(header) : undefined;
  const paymentTx = receipt?.success && receipt.transaction ? (receipt.transaction as Hex) : undefined;
  if (res.status !== 200) {
    return { endpoint, status: res.status, error: await res.text(), ...(paymentTx ? { paymentTx } : {}) };
  }
  const response = checkResponseSchema.parse(await res.json());
  return { endpoint, status: 200, response, ...(paymentTx ? { paymentTx } : {}) };
}
