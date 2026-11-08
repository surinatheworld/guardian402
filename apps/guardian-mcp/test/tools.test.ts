// Bonus B2: the Guardian's MCP tools ask for an x402 payment at the API's prices, run the pipeline once paid,
// and charge nothing for a failed check. A fake facilitator stands in for settlement; the payment itself is a
// real EIP-3009 authorization signed by the x402 client with a throwaway key.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme as ServerScheme } from "@x402/evm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createx402MCPClient } from "@x402/mcp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { FUJI_CAIP2, getAddresses, USDC_FUJI } from "@guardian402/shared";
import { InputError, type Pipeline } from "@guardian402/guardian/pipeline";
import { createGuardianMcpServer, type Settled } from "../src/tools.ts";

const d = getAddresses("fuji");
const TX = `0x${"ab".repeat(32)}`;
const CHECK_ID = `0x${"cd".repeat(32)}`;
const calls = [{ target: d.router, value: "0", data: "0x" }];
const payerOf = (payload: { payload: unknown }) => {
  const from = (payload.payload as { authorization?: { from?: string } }).authorization?.from;
  return from ? { payer: from } : {};
};

function setup(opts: { failRun?: boolean } = {}) {
  const settled: Settled[] = [];
  const facilitatorCalls = { verify: 0, settle: 0 };
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: FUJI_CAIP2 }],
      extensions: [],
      signers: {},
    }),
    verify: async (payload) => {
      facilitatorCalls.verify++;
      return { isValid: true, ...payerOf(payload) };
    },
    settle: async (payload) => {
      facilitatorCalls.settle++;
      return {
        success: true,
        transaction: TX,
        network: FUJI_CAIP2,
        ...payerOf(payload),
      };
    },
  };
  const runs: string[] = [];
  const pipeline = {
    parse: (body: { vault: string; calls: unknown[] }) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(body.vault))
        throw new InputError({ fieldErrors: { vault: ["invalid"] } });
      return body;
    },
    run: async (_req: unknown, endpoint: string) => {
      runs.push(endpoint);
      if (opts.failRun) throw new Error("https://rpc.example/key refused");
      return { checkId: CHECK_ID, risk: "LOW", score: 0, ...(endpoint === "cosign" ? { verdict: {} } : {}) };
    },
  } as unknown as Pipeline;
  return { settled, facilitatorCalls, runs, facilitator, pipeline };
}

async function connect(s: ReturnType<typeof setup>, payer = privateKeyToAccount(generatePrivateKey())) {
  const resourceServer = new x402ResourceServer(s.facilitator).register(FUJI_CAIP2, new ServerScheme());
  await resourceServer.initialize();
  const server = await createGuardianMcpServer({
    pipeline: s.pipeline,
    resourceServer,
    payTo: d.deployer,
    onSettled: (x) => s.settled.push(x),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const asked: string[] = [];
  const client = createx402MCPClient({
    name: "test-agent",
    version: "0.0.0",
    schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(payer) }],
    spendControls: {
      allowedAssets: [{ network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: "20000" }],
    },
    onPaymentRequested: ({ paymentRequired }) => {
      asked.push(paymentRequired.accepts[0]?.amount ?? "?");
      return BigInt(paymentRequired.accepts[0]?.amount ?? "0") <= 20_000n;
    },
  });
  await client.connect(b);
  return { client, asked, payer };
}

describe("Guardian MCP tools (B2)", () => {
  it("lists the two paid tools", async () => {
    const { client } = await connect(setup());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_transaction", "cosign_transaction"]);
  });

  it("asks an unpaid caller for 0.005 USDC on Fuji, paid to the Guardian, without running the check", async () => {
    const s = setup();
    const resourceServer = new x402ResourceServer(s.facilitator).register(FUJI_CAIP2, new ServerScheme());
    await resourceServer.initialize();
    const server = await createGuardianMcpServer({ pipeline: s.pipeline, resourceServer, payTo: d.deployer });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const plain = new Client({ name: "no-wallet", version: "0.0.0" });
    await plain.connect(b);
    const r = await plain.callTool({ name: "check_transaction", arguments: { vault: d.vault, calls } });
    expect(r.isError).toBe(true);
    const req = r.structuredContent as {
      accepts: { amount: string; asset: string; network: string; payTo: string }[];
    };
    expect(req.accepts[0]).toMatchObject({
      amount: "5000",
      asset: USDC_FUJI.address,
      network: FUJI_CAIP2,
      payTo: d.deployer,
    });
    expect(s.runs).toEqual([]);
  });

  it("pays, runs the check and settles, linking the payment to its check", async () => {
    const s = setup();
    const { client, asked, payer } = await connect(s);
    const r = await client.callTool("check_transaction", { vault: d.vault, calls });
    expect(r.isError).toBeFalsy();
    expect(asked).toEqual(["5000"]);
    expect(r.paymentMade).toBe(true);
    expect(r.paymentResponse?.transaction).toBe(TX);
    expect(s.runs).toEqual(["check"]);
    expect(s.settled).toEqual([
      { tool: "check_transaction", payer: payer.address, amount: "5000", transaction: TX, checkId: CHECK_ID },
    ]);
  });

  it("charges 0.01 USDC for the co-signed verdict", async () => {
    const s = setup();
    const { client, asked } = await connect(s);
    const r = await client.callTool("cosign_transaction", { vault: d.vault, calls });
    expect(r.isError).toBeFalsy();
    expect(asked).toEqual(["10000"]);
    expect(s.runs).toEqual(["cosign"]);
    expect(s.settled[0]).toMatchObject({ tool: "cosign_transaction", amount: "10000" });
  });

  it("does not charge for a failed check and keeps internal errors private", async () => {
    const s = setup({ failRun: true });
    const { client } = await connect(s);
    const r = await client.callTool("check_transaction", { vault: d.vault, calls });
    expect(r.isError).toBe(true);
    const first = r.content[0] as unknown as { text: string };
    expect(JSON.parse(first.text)).toEqual({ error: "check failed" });
    expect(s.facilitatorCalls.settle).toBe(0);
    expect(s.settled).toEqual([]);
  });

  it("does not charge for an invalid request", async () => {
    const s = setup();
    const { client } = await connect(s);
    const r = await client.callTool("check_transaction", { vault: "not-an-address", calls });
    expect(r.isError).toBe(true);
    expect(s.facilitatorCalls.settle).toBe(0);
  });
});
