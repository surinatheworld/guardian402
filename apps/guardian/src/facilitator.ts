// Self-hosted x402 facilitator (docs/SPEC.md §6.4), following the Team1 x402 starter. Used by
// the E2E tests (pointed at the fork) and as the demo fallback when the public facilitator is down.
// It pays settlement gas from FACILITATOR_PK, so keep a little AVAX in that wallet.
import express, { type NextFunction, type Request, type Response } from "express";
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
  // Both routes take { paymentPayload, paymentRequirements } (x402 facilitator API). Anything else is a 400 in
  // JSON: without this check a body with a missing field threw inside the scheme and Express answered 500 with
  // an HTML stack trace.
  const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  const wellFormed = (req: Request, res: Response, next: NextFunction) => {
    const b = req.body as { paymentPayload?: unknown; paymentRequirements?: unknown } | undefined;
    if (!isObject(b) || !isObject(b?.paymentPayload) || !isObject(b?.paymentRequirements)) {
      res
        .status(400)
        .json({ error: "invalid request", details: "paymentPayload and paymentRequirements are required" });
      return;
    }
    next();
  };
  app.post("/verify", wellFormed, async (req, res) => {
    const result = await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements);
    opts.log?.(result.isValid ? `verified ${result.payer}` : `refused: ${result.invalidReason}`);
    res.json(result);
  });
  app.post("/settle", wellFormed, async (req, res) => {
    const result = await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements);
    // The first line of the node's error only: viem's later lines repeat the calldata, which holds the payer's
    // EIP-3009 signature.
    const why = result.errorMessage?.split("\n")[0]?.slice(0, 200);
    opts.log?.(
      result.success
        ? `settled ${result.transaction}`
        : `not settled: ${result.errorReason}${why ? ` (${why})` : ""}`,
    );
    res.json(result);
  });
  // Malformed JSON, or an error thrown while verifying or settling: JSON, never an HTML page with a stack trace.
  app.use(
    (
      err: { status?: number; type?: string; message?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      if (err.type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid request", details: "malformed JSON body" });
        return;
      }
      opts.log?.(
        `error: ${String(err.message ?? err)
          .split("\n")[0]
          ?.slice(0, 200)}`,
      );
      res.status(err.status === 413 ? 413 : 500).json({ error: "facilitator error" });
    },
  );
  return { app, address: account.address };
}
