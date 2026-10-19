// The seller: an API where one route costs USDC. Run it with `npm run server`.
//
// How one paid request goes:
// 1. A request with no payment gets status 402 and a PAYMENT-REQUIRED header: how much, which token, to whom.
// 2. The buyer signs that payment and asks again with a PAYMENT-SIGNATURE header.
// 3. The middleware asks the facilitator to check the signature, then runs the route.
// 4. The facilitator sends the transfer on chain and pays the gas. The answer goes out with a
//    PAYMENT-RESPONSE header that holds the transaction hash.
import express from "express";
import { createPublicClient, http } from "viem";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { FACILITATOR_URL, NET, address, fromUnits, price, stop, txLink } from "./networks.mjs";

const PORT = Number(process.env.PORT || 4021);
const PAY_TO = address("PAY_TO");
const PRICE = process.env.PRICE_USDC || "0.001";

// "exact" is the x402 scheme for a fixed price: the buyer pays exactly the amount asked.
const payments = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL })).register(NET.id, new ExactEvmScheme());

// Ask the facilitator what it supports before taking requests, so a wrong URL fails here and not on the first buyer.
try {
  await payments.initialize();
} catch {
  stop(`No facilitator answers at ${FACILITATOR_URL}. Check FACILITATOR_URL in .env.local.`);
}
if (!payments.getSupportedKind(2, NET.id, "exact")) stop(`The facilitator at ${FACILITATOR_URL} does not handle ${NET.name} (${NET.id}).`);

payments.onAfterVerify(async ({ result }) => {
  if (!result.isValid) console.log(`Refused a payment from ${result.payer || "an unknown wallet"}: ${result.invalidReason}`);
});
payments.onAfterSettle(async ({ result, requirements }) => {
  if (result.success) console.log(`Paid ${fromUnits(requirements.amount)} USDC by ${result.payer}: ${txLink(result.transaction)}`);
  else console.log(`A payment from ${result.payer || "an unknown wallet"} did not settle: ${result.errorReason}`);
});

const app = express();

// One line per paid route: the method and path, and what a request costs. Routes not listed here stay free.
app.use(
  paymentMiddleware(
    {
      "GET /api/gas": {
        accepts: [{ scheme: "exact", network: NET.id, payTo: PAY_TO, price: price(PRICE) }],
        description: `The latest block and gas price on ${NET.name}`,
        mimeType: "application/json",
      },
    },
    payments,
  ),
);

app.get("/", (req, res) => {
  res.json({ name: "x402 pay per request", network: NET.name, free: ["GET /"], paid: { "GET /api/gas": `${PRICE} USDC` } });
});

// The paid route. It runs only after the facilitator has checked the payment, and the buyer is charged only
// if it answers with success: an error status goes back as it is and the payment is never settled.
const chain = createPublicClient({ chain: NET.chain, transport: http(NET.rpc) });
app.get("/api/gas", async (req, res) => {
  try {
    const block = await chain.getBlock();
    res.json({
      network: NET.name,
      block: Number(block.number),
      baseFeeWei: String(block.baseFeePerGas ?? 0n),
      time: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
  } catch {
    res.status(502).json({ error: `Could not read ${NET.name}. You were not charged.` });
  }
});

app.listen(PORT, () => {
  console.log(`Selling GET /api/gas for ${PRICE} USDC on ${NET.name}, paid to ${PAY_TO}.`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Listening on http://localhost:${PORT}`);
});
