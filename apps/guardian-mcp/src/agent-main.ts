// `pnpm mcp:agent`: the agent-side MCP server over stdio (agent-tools.ts). Add it to the agent's MCP client
// (Claude Desktop, Claude Code, any MCP framework) with three settings; the dashboard's Agent page prints the
// exact config with the key filled in:
//
//   GUARDIAN_API_URL  the dashboard's agent API, e.g. http://localhost:3000/api/agent/v1
//   GUARDIAN_API_KEY  g402_… from the dashboard (identifies the agent and its vault)
//   AGENT_PK          the agent wallet key (0x…); signs the x402 fee and executeBatch, never leaves this process
//
// Optional: CHAIN_RPC_URL (default the public Fuji RPC). Logs go to stderr; stdout is the MCP channel.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentVaultAbi,
  FUJI_CAIP2,
  FUJI_RPC_URL,
  fujiChain,
  rpcTransport,
  USDC_FUJI,
  type Call,
  type CheckResponse,
} from "@guardian402/shared";
import { createAgentMcpServer, type AgentApi, type AgentMe, type VaultSender } from "./agent-tools.ts";

const MAX_FEE_ATOMIC = "20000"; // 0.02 USDC: the x402 client refuses any Guardian fee above it

function need(name: string, test: RegExp): string {
  const v = process.env[name]?.trim();
  if (!v || !test.test(v)) {
    console.error(`[guardian402-agent] ${name} is missing or invalid`);
    process.exit(1);
  }
  return v;
}

const base = need("GUARDIAN_API_URL", /^https?:\/\/\S+$/).replace(/\/$/, "");
const apiKey = need("GUARDIAN_API_KEY", /^g402_[A-Za-z0-9_-]{20,64}$/);
const agent = privateKeyToAccount(need("AGENT_PK", /^0x[0-9a-fA-F]{64}$/) as Hex);
const rpc = process.env.CHAIN_RPC_URL?.trim() || FUJI_RPC_URL;

const auth = { authorization: `Bearer ${apiKey}` };
const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: FUJI_CAIP2, client: new ExactEvmScheme(agent) }],
  spendControls: {
    allowedAssets: [{ network: FUJI_CAIP2, asset: USDC_FUJI.address, maxAmountPerPayment: MAX_FEE_ATOMIC }],
  },
});

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; error?: string };
    throw new Error(b.message ?? b.error ?? `HTTP ${res.status}`);
  }
  return body;
}

const api: AgentApi = {
  me: async () => (await json(await fetch(`${base}/me`, { headers: auth }))) as AgentMe,
  ask: async (endpoint, calls) => {
    const body = JSON.stringify({
      calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
    });
    // A 503 is the Guardian's own state (busy, or its fork catching up with a new vault), never a verdict, and
    // it is not charged: ask again after Retry-After (at most 10 s), twice at most.
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await payingFetch(`${base}/${endpoint}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body,
      });
      if (res.status !== 503 || attempt >= 2) break;
      await res.body?.cancel();
      const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    const header = res.headers.get("PAYMENT-RESPONSE");
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    const paymentTx = receipt?.success && receipt.transaction ? (receipt.transaction as Hex) : undefined;
    return {
      status: res.status,
      body: await res.json().catch(() => ({})),
      ...(paymentTx ? { paymentTx } : {}),
    };
  },
  transaction: async (hash) => json(await fetch(`${base}/transactions/${hash}`, { headers: auth })),
};

const chain = createPublicClient({ chain: fujiChain, transport: rpcTransport(rpc) });
const wallet = createWalletClient({ account: agent, chain: fujiChain, transport: rpcTransport(rpc) });

// No verdict: an empty one and an empty signature, which the vault reads as "without the Guardian" (it then
// requires one only above the verdict threshold, for approvals and for calls to apps).
const NO_VERDICT = {
  callsHash: `0x${"0".repeat(64)}`,
  nonce: 0n,
  deadline: 0n,
  risk: 0,
  checkId: `0x${"0".repeat(64)}`,
} as const;

const args = (calls: Call[], v: CheckResponse["verdict"]) => {
  if (!v) return [calls, NO_VERDICT, "0x"] as const;
  return [
    calls,
    {
      callsHash: v.callsHash,
      nonce: BigInt(v.nonce),
      deadline: BigInt(v.deadline),
      risk: v.risk,
      checkId: v.checkId,
    },
    v.signature,
  ] as const;
};

const sender: VaultSender = {
  simulate: async (vault: Address, calls, v) => {
    try {
      await chain.simulateContract({
        account: agent,
        address: vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args: args(calls, v),
      });
      return {};
    } catch (e) {
      const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      return {
        revert:
          r instanceof ContractFunctionRevertedError
            ? (r.data?.errorName ?? r.reason ?? "unknown")
            : ((e as BaseError).shortMessage ?? String(e)),
      };
    }
  },
  send: async (vault, calls, v) => {
    const tx = await wallet.writeContract({
      address: vault,
      abi: agentVaultAbi,
      functionName: "executeBatch",
      args: args(calls, v),
    });
    const receipt = await chain.waitForTransactionReceipt({ hash: tx });
    return { tx, status: receipt.status === "success" ? "success" : "reverted" };
  },
};

const server = createAgentMcpServer({ api, sender, usdc: USDC_FUJI.address });
await server.connect(new StdioServerTransport());
console.error(`[guardian402-agent] ready · agent ${agent.address} · ${base}`);
