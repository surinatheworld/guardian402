// Self-hosted x402 facilitator (docs/SPEC.md §6.4), following the Team1 x402 starter. Used by
// the E2E tests (pointed at the fork) and as the demo fallback when the public facilitator is down.
// It pays settlement gas from FACILITATOR_PK, so keep a little AVAX in that wallet.
import express from "express";
import { createWalletClient, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { FUJI_CAIP2, fujiChain, rpcTransport } from "@guardian402/shared";

export function createFacilitatorApp(opts: {
  rpcUrl: string;
  privateKey: Hex;
  log?: (line: string) => void;
}) {
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({
    account,
    chain: fujiChain,
    transport: rpcTransport(opts.rpcUrl),
  }).extend(publicActions);
  const signer = toFacilitatorEvmSigner({
    address: account.address,
    getCode: (args) => wallet.getCode(args),
    readContract: (args) => wallet.readContract(args),
    // x402's signer type is looser than viem's overloads; the starter passes the args through unchanged.
    verifyTypedData: (args) => wallet.verifyTypedData(args as Parameters<typeof wallet.verifyTypedData>[0]),
    writeContract: (args) => wallet.writeContract(args),
    sendTransaction: (args) => wallet.sendTransaction(args),
    waitForTransactionReceipt: (args) => wallet.waitForTransactionReceipt(args),
  });
  const facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, { signer, networks: FUJI_CAIP2 });

  const app = express();
  app.use(express.json());
  app.get("/supported", (_req, res) => {
    res.json(facilitator.getSupported());
  });
  app.post("/verify", async (req, res) => {
    const result = await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements);
    opts.log?.(result.isValid ? `verified ${result.payer}` : `refused: ${result.invalidReason}`);
    res.json(result);
  });
  app.post("/settle", async (req, res) => {
    const result = await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements);
    opts.log?.(result.success ? `settled ${result.transaction}` : `not settled: ${result.errorReason}`);
    res.json(result);
  });
  return { app, address: account.address };
}
