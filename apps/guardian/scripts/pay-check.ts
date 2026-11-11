// One paid Guardian call from the agent wallet, for checks and the demo runbook:
//   pnpm --filter @guardian402/guardian pay-check [check|cosign]
// Sends S1 (approve 2 USDC + swap via pool 0) for the NETWORK's vault to GUARDIAN_URL (default
// http://127.0.0.1:4402), pays with @x402/fetch (at most 0.02 USDC) and prints the settlement link.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  DEMO_ORACLE_PRICE,
  FUJI_CAIP2,
  getAddresses,
  minOutUsdcToWavax,
  mockRouterAbi,
  parseNetwork,
  txUrl,
  USDC_FUJI,
} from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));

const endpoint = process.argv[2] === "cosign" ? "cosign" : "check";
const a = getAddresses(parseNetwork(process.env.NETWORK));
const agent = privateKeyToAccount(process.env.AGENT_PK as Hex);
const url = `${process.env.GUARDIAN_URL || "http://127.0.0.1:4402"}/v1/${endpoint}`;
const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(agent) }],
  spendControls: {
    allowedAssets: [{ network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: "20000" }],
  },
});
const body = {
  chainId: 43113,
  vault: a.vault,
  calls: [
    {
      target: a.usdc,
      value: "0",
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.router, 2_000_000n] }),
    },
    {
      target: a.router,
      value: "0",
      data: encodeFunctionData({
        abi: mockRouterAbi,
        functionName: "swapExactIn",
        args: [a.usdc, a.mWAVAX, 2_000_000n, minOutUsdcToWavax(2_000_000n, DEMO_ORACLE_PRICE), 0, a.vault],
      }),
    },
  ],
};
const t0 = performance.now();
const res = await payingFetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ms = Math.round(performance.now() - t0);
const out = (await res.json()) as { risk?: string; checkId?: string; explanation?: { vi: string } };
console.log(`HTTP ${res.status} in ${ms} ms · risk ${out.risk} · checkId ${out.checkId}`);
if (out.explanation) console.log(`Giải thích: ${out.explanation.vi}`);
if (res.status === 402) {
  const required = res.headers.get("PAYMENT-REQUIRED");
  const reason = required ? decodePaymentRequiredHeader(required).error : undefined;
  const settle = res.headers.get("PAYMENT-RESPONSE");
  const failed = settle ? decodePaymentResponseHeader(settle) : undefined;
  console.log(
    `Thanh toán bị từ chối: ${reason ?? failed?.errorReason ?? JSON.stringify(out)}${failed?.errorMessage ? ` (${failed.errorMessage})` : ""}`,
  );
  process.exit(1);
}
const header = res.headers.get("PAYMENT-RESPONSE");
if (header) {
  const r = decodePaymentResponseHeader(header);
  console.log(`Đã trả phí x402 (${endpoint}): ${txUrl(r.transaction as Hex)}`);
} else {
  console.log("Không có biên nhận thanh toán: không bị trừ tiền.");
}
