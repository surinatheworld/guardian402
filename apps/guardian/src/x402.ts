// x402 paywall (docs/SPEC.md §6.4) with @x402/express 2.28.0. Fuji USDC is not a default x402 asset, so prices
// name it as an AssetAmount. The middleware settles only after the handler answered < 400, and the client gets
// the response only when settlement succeeded, so no verdict leaks unpaid.
import type { Address } from "viem";
import { HTTPFacilitatorClient, type HTTPTransportContext, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { x402ResourceServer } from "@x402/express";
import { FUJI_CAIP2, PRICES, USDC_FUJI } from "@guardian402/shared";
import type { Store } from "./store.ts";

export const usdc = (atomic: string) => ({
  asset: USDC_FUJI.address,
  amount: atomic,
  extra: { name: USDC_FUJI.eip712Name, version: USDC_FUJI.eip712Version },
});

export function paidRoutes(payTo: Address): RoutesConfig {
  return {
    "POST /v1/check": {
      accepts: {
        scheme: "exact",
        price: usdc(PRICES.check),
        network: FUJI_CAIP2,
        payTo,
        maxTimeoutSeconds: 60,
      },
      description: "Guardian402: simulate and score a transaction",
      mimeType: "application/json",
    },
    "POST /v1/wallet/check": {
      accepts: {
        scheme: "exact",
        price: usdc(PRICES.check),
        network: FUJI_CAIP2,
        payTo,
        maxTimeoutSeconds: 60,
      },
      description: "Guardian402: simulate and score a transaction from any wallet before it signs",
      mimeType: "application/json",
    },
    "POST /v1/cosign": {
      accepts: {
        scheme: "exact",
        price: usdc(PRICES.cosign),
        network: FUJI_CAIP2,
        payTo,
        maxTimeoutSeconds: 60,
      },
      description: "Guardian402: check plus a signed verdict for AgentVault",
      mimeType: "application/json",
    },
  };
}

/** The checkId the handler put in the (buffered) JSON response, to link a payment to its check. */
function checkIdOf(transport: unknown): string | null {
  const body = (transport as HTTPTransportContext | undefined)?.responseBody;
  if (!body) return null;
  try {
    const id = (JSON.parse(body.toString("utf8")) as { checkId?: unknown }).checkId;
    return typeof id === "string" && /^0x[0-9a-fA-F]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type PaymentLog = (line: {
  event: "settled" | "settle-failed" | "verify-refused";
  [k: string]: unknown;
}) => void;

export function createResourceServer(opts: {
  facilitatorUrl: string;
  store?: Store;
  log?: PaymentLog;
}): x402ResourceServer {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: opts.facilitatorUrl })).register(
    FUJI_CAIP2,
    new ExactEvmScheme(),
  );
  server.onAfterVerify(async ({ result }) => {
    if (!result.isValid)
      opts.log?.({ event: "verify-refused", reason: result.invalidReason, payer: result.payer });
  });
  // @x402/core 2.28.0 runs afterSettle only after a successful settlement; a failed one (the facilitator said
  // no, or could not be reached) goes to onSettleFailure. The caller then gets 402 and no check result.
  server.onSettleFailure(async ({ error }) => {
    const e = error as { errorReason?: string; payer?: string; message?: string };
    opts.log?.({ event: "settle-failed", reason: e.errorReason ?? e.message ?? "unknown", payer: e.payer });
  });
  server.onAfterSettle(async ({ result, requirements, transportContext }) => {
    if (!result.success) return;
    const path = (transportContext as HTTPTransportContext | undefined)?.request.path ?? "";
    const endpoint = path.endsWith("/cosign") ? "cosign" : "check";
    const checkId = checkIdOf(transportContext);
    opts.store?.insertPayment({
      payer: result.payer ?? null,
      amount: requirements.amount,
      txHash: result.transaction,
      endpoint,
      checkId,
    });
    opts.log?.({
      event: "settled",
      payer: result.payer,
      amount: requirements.amount,
      tx: result.transaction,
      checkId,
    });
  });
  return server;
}
