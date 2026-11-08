// `pnpm mcp:example [check|cosign]`: an agent calls the Guardian's MCP tool and pays for it over x402
// (bonus B2). It starts the MCP server over stdio, lists the tools, asks for a check of the S1 batch
// (approve 2 USDC + swap through the normal pool) and prints the risk and the settlement.
//
// Spending limits, enforced on the client side before anything is signed:
// - spendControls: only Fuji USDC, at most 0.02 USDC per payment (the x402 client refuses anything else);
// - onPaymentRequested: refuses any request above 0.02 USDC, in case a server asks for more.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createx402MCPClient } from "@x402/mcp";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FUJI_CAIP2, getAddresses, mockRouterAbi, parseNetwork, txUrl, USDC_FUJI } from "@guardian402/shared";

const MAX_PAYMENT_ATOMIC = 20_000n; // 0.02 USDC
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
const pk = process.env.AGENT_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk ?? "")) throw new Error("AGENT_PK is missing in .env.local");
const agent = privateKeyToAccount(pk as Hex);
const d = getAddresses(parseNetwork(process.env.NETWORK));
const tool = process.argv[2] === "cosign" ? "cosign_transaction" : "check_transaction";

const client = createx402MCPClient({
  name: "guardian402-example-agent",
  version: "0.1.0",
  schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(agent) }],
  spendControls: {
    allowedAssets: [
      { network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: MAX_PAYMENT_ATOMIC.toString() },
    ],
  },
  autoPayment: true,
  onPaymentRequested: ({ toolName, paymentRequired }) => {
    const ask = paymentRequired.accepts[0];
    const ok = ask !== undefined && BigInt(ask.amount) <= MAX_PAYMENT_ATOMIC;
    console.log(
      `[agent] ${toolName} asks ${ask ? Number(ask.amount) / 1e6 : "?"} USDC → ${ok ? "pay" : "refuse"}`,
    );
    return ok;
  },
});

// The server inherits this environment (network, keys, fork); its logs go to our stderr.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", join(dirname(fileURLToPath(import.meta.url)), "main.ts")],
  env: Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  ),
  stderr: "inherit",
});
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`[agent] tools: ${tools.map((t) => t.name).join(", ")}`);

const calls = [
  {
    target: d.usdc,
    value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.router, 2_000_000n] }),
  },
  {
    target: d.router,
    value: "0",
    data: encodeFunctionData({
      abi: mockRouterAbi,
      functionName: "swapExactIn",
      args: [d.usdc, d.mWAVAX, 2_000_000n, 0n, 0, d.vault],
    }),
  },
];
const result = await client.callTool(tool, { vault: d.vault, calls });
const first = result.content[0];
const body = JSON.parse(first && "text" in first ? String(first.text) : "{}") as {
  risk?: string;
  score?: number;
  explanation?: { vi?: string };
  verdict?: unknown;
  error?: string;
};
if (result.isError) {
  console.log(`[agent] ${tool} failed, not charged: ${body.error ?? "unknown error"}`);
} else {
  console.log(`[agent] risk ${body.risk} (${body.score}/100): ${body.explanation?.vi ?? ""}`);
  if (body.verdict) console.log("[agent] signed verdict received");
}
console.log(
  result.paymentMade && result.paymentResponse
    ? `[agent] paid: ${txUrl(result.paymentResponse.transaction as Hex)}`
    : "[agent] no payment made",
);
await client.close();
process.exit(result.isError ? 1 : 0);
