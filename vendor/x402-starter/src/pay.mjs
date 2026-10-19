// The buyer: asks for the paid route, gets 402, signs a USDC payment and asks again. Run it with `npm run pay`.
//
// The buyer never sends a transaction and needs no AVAX. It signs a message that lets the facilitator move
// exactly this amount of USDC to exactly this seller (transferWithAuthorization, EIP-3009).
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { NET, fromUnits, privateKey, stop, toUnits, txLink } from "./networks.mjs";

const URL = process.argv[2] || process.env.API_URL || "http://localhost:4021/api/gas";
const MAX_PRICE = process.env.MAX_PRICE_USDC || "0.01";
const account = privateKeyToAccount(privateKey("BUYER_PRIVATE_KEY", "Run `npm run new-wallet` and paste the line it prints."));

// A program that pays by itself needs a limit it cannot talk itself out of. spendControls is that limit:
// only USDC, only on the chosen network, and never more than MAX_PRICE_USDC for one request.
// The library refuses every token it does not know, and it does not know USDC on Fuji, so it is named here.
const client = x402Client.fromConfig({
  schemes: [{ network: NET.id, client: new ExactEvmScheme(account) }],
  spendControls: { allowedAssets: [{ network: NET.id, asset: NET.usdc, maxAmountPerPayment: toUnits(MAX_PRICE) }] },
});
client.onBeforePaymentCreation(async ({ selectedRequirements: asked }) => {
  console.log(`402 Payment Required: ${fromUnits(asked.amount)} USDC to ${asked.payTo} on ${NET.name}.`);
  console.log(`Signing with ${account.address} and asking again.`);
});

const payingFetch = wrapFetchWithPayment(fetch, client);

let response;
try {
  response = await payingFetch(URL);
} catch (error) {
  const message = String(error?.message || error);
  if (/spendControls/.test(message)) stop(`Not paid: the seller asks for more than ${MAX_PRICE} USDC, or for another token. Raise MAX_PRICE_USDC if you agree with the price.`);
  if (/fetch failed/.test(message) || error?.cause?.code === "ECONNREFUSED") stop(`Nothing answers at ${URL}. Start the seller with \`npm run server\`.`);
  stop(`Not paid: ${message}`);
}

if (response.status === 402) {
  const refused = decodePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED"));
  if (/insufficient/.test(refused.error || "")) stop(`Not paid: ${account.address} does not hold enough USDC on ${NET.name}.${NET.key === "fuji" ? " Test USDC is free at https://faucet.circle.com (choose Avalanche Fuji)." : ""}`);
  stop(`Not paid: ${refused.error || "the payment was refused"}.`);
}

console.log(`Status ${response.status}`);
console.log(await response.text());

// The seller's answer carries the receipt. No receipt means no money moved, which is what happens when the route fails.
const receipt = response.headers.get("PAYMENT-RESPONSE");
if (!receipt) stop("Nothing was paid for this request.");
console.log(`Paid. Transaction: ${txLink(decodePaymentResponseHeader(receipt).transaction)}`);
