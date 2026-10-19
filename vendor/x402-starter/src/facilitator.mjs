// Optional: your own facilitator. Run it with `npm run facilitator`, then set FACILITATOR_URL=http://localhost:4022.
//
// A facilitator does two jobs for a seller, so the seller needs no wallet key and no blockchain code:
// verify: is this signature real, and does the buyer hold the money?
// settle: send the buyer's signed transfer to the USDC contract and pay the gas for it.
// The public ones on Avalanche do exactly this. Run your own when you want no outside service in your demo,
// or when your project lives on an L1 that no public facilitator knows.
import express from "express";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { NET, privateKey, txLink } from "./networks.mjs";

const PORT = Number(process.env.FACILITATOR_PORT || 4022);
const account = privateKeyToAccount(privateKey("FACILITATOR_PRIVATE_KEY", "It is the key of a wallet with a little AVAX for gas."));
const wallet = createWalletClient({ account, chain: NET.chain, transport: http(NET.rpc) }).extend(publicActions);

// The library only needs these few calls from a wallet. This wallet pays the gas of every settlement.
const signer = toFacilitatorEvmSigner({
  address: account.address,
  getCode: (args) => wallet.getCode(args),
  readContract: (args) => wallet.readContract(args),
  verifyTypedData: (args) => wallet.verifyTypedData(args),
  writeContract: (args) => wallet.writeContract(args),
  sendTransaction: (args) => wallet.sendTransaction(args),
  waitForTransactionReceipt: (args) => wallet.waitForTransactionReceipt(args),
});

const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, { signer, networks: NET.id });

const app = express();
app.use(express.json());

// The three addresses every x402 facilitator answers on.
app.get("/supported", (req, res) => res.json(facilitator.getSupported()));

app.post("/verify", async (req, res) => {
  const result = await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements);
  console.log(result.isValid ? `Verified a payment from ${result.payer}` : `Refused a payment from ${result.payer || "an unknown wallet"}: ${result.invalidReason}`);
  res.json(result);
});

app.post("/settle", async (req, res) => {
  const result = await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements);
  console.log(result.success ? `Settled: ${txLink(result.transaction)}` : `Did not settle: ${result.errorReason}`);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Facilitator for ${NET.name} on http://localhost:${PORT}`);
  console.log(`Gas is paid by ${account.address}. Keep a little AVAX in it.`);
});
