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

export type PayingFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * A 503 is the Guardian's own state, never a verdict on the batch: too many checks waiting for the fork, or a
 * simulation that could not run (docs/SPEC.md §6.2). Nothing was settled, so the agent was not charged and
 * asking again is safe. Retries are bounded so a Guardian that stays down ends the scenario.
 */
export const UNAVAILABLE_RETRIES = 2;
const DEFAULT_RETRY_MS = 5_000;
const MAX_RETRY_MS = 10_000;

/** `Retry-After` in seconds (what the Guardian sends), capped; anything else → the default wait. */
export function retryAfterMs(header: string | null): number {
  if (header === null || !/^\d+$/.test(header.trim())) return DEFAULT_RETRY_MS;
  return Math.min(Number(header.trim()) * 1000, MAX_RETRY_MS);
}

export type AskOptions = {
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (waitMs: number, attempt: number) => void;
};

export async function askGuardian(
  payingFetch: PayingFetch,
  guardianUrl: string,
  endpoint: "check" | "cosign",
  vault: Address,
  calls: Call[],
  opts: AskOptions = {},
): Promise<GuardianResult> {
  const retries = opts.retries ?? UNAVAILABLE_RETRIES;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const body = {
    chainId: 43113,
    vault,
    calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
  };
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    // Each attempt is a fresh request: the x402 client signs a new payment authorization after the 402.
    res = await payingFetch(`${guardianUrl}/v1/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 503 || attempt > retries) break;
    await res.body?.cancel();
    const wait = retryAfterMs(res.headers.get("retry-after"));
    opts.onRetry?.(wait, attempt);
    await sleep(wait);
  }
  const header = res.headers.get("PAYMENT-RESPONSE");
  const receipt = header ? decodePaymentResponseHeader(header) : undefined;
  const paymentTx = receipt?.success && receipt.transaction ? (receipt.transaction as Hex) : undefined;
  if (res.status !== 200) {
    return { endpoint, status: res.status, error: await res.text(), ...(paymentTx ? { paymentTx } : {}) };
  }
  const response = checkResponseSchema.parse(await res.json());
  return { endpoint, status: 200, response, ...(paymentTx ? { paymentTx } : {}) };
}
