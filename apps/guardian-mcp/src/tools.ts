// Bonus B2 (docs/SPEC.md §13.2): the Guardian's two checks as paid MCP tools. Each tool is wrapped with
// @x402/mcp's createPaymentWrapper at the same price and on the same asset as the HTTP API (Fuji USDC as an
// AssetAmount), and runs the Guardian pipeline as a library, not over HTTP.
//
// As on the HTTP API, nobody pays for a failure: a tool result with isError=true is not settled
// (@x402/mcp cancels the settlement), and the pipeline never turns an error into a verdict.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload } from "@x402/core/types";
import { createPaymentWrapper } from "@x402/mcp";
import { z } from "zod";
import type { Address } from "viem";
import { FUJI_CAIP2, FUJI_CHAIN_ID, PRICES } from "@guardian402/shared";
import { InputError, UnavailableError, type Pipeline } from "@guardian402/guardian/pipeline";
import { usdc } from "@guardian402/guardian/x402";

export const TOOL_NAMES = ["check_transaction", "cosign_transaction"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const TOOLS: Record<
  ToolName,
  { endpoint: "check" | "cosign"; price: string; title: string; description: string }
> = {
  check_transaction: {
    endpoint: "check",
    price: PRICES.check,
    title: "Check an agent transaction",
    description:
      "Simulate an AgentVault batch on a fork of Avalanche Fuji and score it with 8 deterministic rules. " +
      "Returns the risk (LOW, MEDIUM, HIGH), the findings, the balance changes and an explanation in " +
      "Vietnamese and English. Costs 0.005 USDC on Fuji, paid over x402.",
  },
  cosign_transaction: {
    endpoint: "cosign",
    price: PRICES.cosign,
    title: "Check and co-sign an agent transaction",
    description:
      "Same as check_transaction, plus an EIP-712 verdict signed by the Guardian, bound to these exact calls " +
      "and the vault's next nonce; AgentVault accepts it for 60 seconds when the risk is allowed. " +
      "Costs 0.01 USDC on Fuji, paid over x402.",
  },
};

const inputShape = {
  vault: z.string().describe("AgentVault address on Avalanche Fuji"),
  calls: z
    .array(
      z.object({
        target: z.string().describe("contract or recipient address"),
        value: z.string().default("0").describe("AVAX in wei, as a decimal string"),
        data: z.string().default("0x").describe("calldata, 0x-prefixed hex"),
      }),
    )
    .min(1)
    .max(8)
    .describe("the batch the agent wants AgentVault to run, in order"),
};

export type Settled = {
  tool: ToolName;
  payer: string | null;
  amount: string;
  transaction: string;
  checkId: string | null;
};

export type McpDeps = {
  pipeline: Pipeline;
  /** Initialized, with the exact EVM scheme registered for Fuji. */
  resourceServer: x402ResourceServer;
  payTo: Address;
  onSettled?: (s: Settled) => void;
};

const text = (value: unknown) => [{ type: "text" as const, text: JSON.stringify(value) }];

export async function createGuardianMcpServer(d: McpDeps): Promise<McpServer> {
  const server = new McpServer({ name: "guardian402", version: "0.1.0" });
  for (const name of TOOL_NAMES) {
    const tool = TOOLS[name];
    const accepts = await d.resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network: FUJI_CAIP2,
      payTo: d.payTo,
      price: usdc(tool.price),
      maxTimeoutSeconds: 60,
    });
    // The settlement hook has no result, so the checkId travels from the execution hook by payment payload.
    const checkIds = new WeakMap<PaymentPayload, string>();
    const paid = createPaymentWrapper(d.resourceServer, {
      accepts,
      resource: {
        url: `mcp://tool/${name}`,
        description: tool.description,
        mimeType: "application/json",
        serviceName: "Guardian402",
      },
      hooks: {
        onAfterExecution: ({ paymentPayload, result }) => {
          try {
            const id = (JSON.parse(result.content[0]?.text ?? "{}") as { checkId?: unknown }).checkId;
            if (typeof id === "string") checkIds.set(paymentPayload, id);
          } catch {
            // not a check response: nothing to link
          }
        },
        onAfterSettlement: ({ paymentPayload, paymentRequirements, settlement }) => {
          d.onSettled?.({
            tool: name,
            payer: settlement.payer ?? null,
            amount: paymentRequirements.amount,
            transaction: settlement.transaction,
            checkId: checkIds.get(paymentPayload) ?? null,
          });
        },
      },
    });
    server.registerTool(
      name,
      { title: tool.title, description: tool.description, inputSchema: inputShape },
      paid(async (args: { vault: string; calls: { target: string; value: string; data: string }[] }) => {
        try {
          const req = d.pipeline.parse({ chainId: FUJI_CHAIN_ID, vault: args.vault, calls: args.calls });
          return { content: text(await d.pipeline.run(req, tool.endpoint)) };
        } catch (e) {
          // Same rule as the HTTP API: no internal error text to callers, and no charge.
          const body =
            e instanceof InputError
              ? { error: "invalid request", details: e.details }
              : e instanceof UnavailableError
                ? { error: "simulation unavailable, try again in a few seconds" }
                : { error: "check failed" };
          return { content: text(body), isError: true };
        }
      }),
    );
  }
  return server;
}
