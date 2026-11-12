// The agent-side MCP server (`pnpm mcp:agent`): what an owner's AI agent runs next to itself. It holds the
// agent's Guardian API key and its wallet key; neither leaves this process. Four tools:
//
//   get_rules        GET  /me             the rules of the agent's vault, as numbers and as plain sentences
//   check_payment    POST /check          a paid Guardian check (0.005 USDC over x402), nothing is sent
//   pay              POST /cosign → AgentVault.executeBatch
//                                         one step: Guardian check + approval (0.01 USDC), then the vault
//                                         executes it with the agent's wallet, or nothing is sent
//   get_transaction  GET  /transactions/:hash   the verified outcome of a transaction
//
// The vault enforces its rules whether or not this server is used; `pay` only avoids sending a transaction the
// Guardian or the vault would refuse, so a blocked payment costs the Guardian fee and no gas.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { checkResponseSchema, txUrl, type Call, type CheckResponse } from "@guardian402/shared";

export const AGENT_TOOL_NAMES = ["get_rules", "check_payment", "pay", "get_transaction"] as const;

/** What the vault's agent wallet does on chain; the real one uses viem (agent-main.ts). */
export type VaultSender = {
  /** Reverts are returned, not thrown: the name of the vault error (e.g. "DailyCapExceeded"). */
  simulate(vault: Address, calls: Call[], verdict: CheckResponse["verdict"]): Promise<{ revert?: string }>;
  send(
    vault: Address,
    calls: Call[],
    verdict: CheckResponse["verdict"],
  ): Promise<{ tx: Hex; status: "success" | "reverted" }>;
};

export type AgentApi = {
  /** GET {base}/me with the API key. */
  me(): Promise<AgentMe>;
  /** POST {base}/check|cosign, paying the Guardian over x402 with the agent wallet. */
  ask(
    endpoint: "check" | "cosign",
    calls: Call[],
  ): Promise<{ status: number; body: unknown; paymentTx?: Hex }>;
  transaction(hash: string): Promise<unknown>;
};

export type AgentMe = {
  vault: Address;
  isOnChainAgent: boolean | null;
  vaultPaused: boolean | null;
  guideline: string[];
  rules: {
    maxRisk: "LOW" | "MEDIUM" | "HIGH";
    tokens: { token: string; symbol: string; decimals: number }[];
  } | null;
};

export type AgentDeps = { api: AgentApi; sender: VaultSender; usdc: Address };

const callShape = z.object({
  target: z.string().describe("contract or recipient address"),
  value: z.string().default("0").describe("AVAX in wei, as a decimal string"),
  data: z.string().default("0x").describe("calldata, 0x-prefixed hex"),
});

const paymentShape = {
  to: z.string().optional().describe("recipient address (must be one the vault allows)"),
  amount: z.string().optional().describe('amount in whole units, e.g. "1.5" for 1.5 USDC'),
  token: z.enum(["USDC", "AVAX"]).default("USDC").describe("what to send"),
  calls: z
    .array(callShape)
    .min(1)
    .max(8)
    .optional()
    .describe("advanced: a raw AgentVault batch instead of to/amount (e.g. approve + swap)"),
};

type PaymentInput = {
  to?: string | undefined;
  amount?: string | undefined;
  token?: "USDC" | "AVAX" | undefined;
  calls?: z.infer<typeof callShape>[] | undefined;
};

/** to/amount → one call; or the raw calls. Throws a message the agent can act on. */
export function toCalls(input: PaymentInput, usdc: Address): Call[] {
  if (input.calls?.length) {
    return input.calls.map((c) => {
      if (!isAddress(c.target)) throw new Error(`invalid target address: ${c.target}`);
      if (!/^0x([0-9a-fA-F]{2})*$/.test(c.data)) throw new Error("data must be 0x-prefixed hex");
      return { target: getAddress(c.target), value: BigInt(c.value), data: c.data as Hex };
    });
  }
  if (!input.to || !isAddress(input.to))
    throw new Error("give `to` (a recipient address) and `amount`, or `calls`");
  if (!input.amount || !/^\d+(\.\d+)?$/.test(input.amount)) throw new Error('`amount` must look like "1.5"');
  const to = getAddress(input.to);
  if ((input.token ?? "USDC") === "AVAX")
    return [{ target: to, value: parseUnits(input.amount, 18), data: "0x" }];
  const amount = parseUnits(input.amount, 6);
  if (amount === 0n) throw new Error("`amount` must be above 0");
  return [
    {
      target: usdc,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
    },
  ];
}

const RISK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

/** The Guardian's answer, short: what an agent needs to decide and to tell its user. */
function summary(r: CheckResponse) {
  return {
    risk: r.risk,
    score: r.score,
    reasons: r.findings.map((f) => f.title),
    explanation: r.explanation.en,
    explanationVi: r.explanation.vi,
    checkId: r.checkId,
  };
}

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

function guardianError(status: number, body: unknown) {
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  const msg =
    typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : `HTTP ${status}`;
  return text({ outcome: "error", status, message: msg, charged: false }, true);
}

export function createAgentMcpServer(d: AgentDeps): McpServer {
  const server = new McpServer({ name: "guardian402-agent", version: "0.1.0" });

  server.registerTool(
    "get_rules",
    {
      title: "Read my spending rules",
      description:
        "Read the rules of the vault this agent spends from: allowed recipients, daily cap, per-transaction cap, " +
        "total budget left, and the highest risk the owner accepts. Free. Call it before planning a payment.",
      inputSchema: {},
    },
    async () => {
      try {
        const me = await d.api.me();
        return text({
          vault: me.vault,
          youAreTheVaultAgent: me.isOnChainAgent,
          vaultLocked: me.vaultPaused,
          guideline: me.guideline,
          rules: me.rules,
        });
      } catch (e) {
        return text({ outcome: "error", message: (e as Error).message }, true);
      }
    },
  );

  server.registerTool(
    "check_payment",
    {
      title: "Check a payment without sending it",
      description:
        "Ask the Guardian to simulate a payment from the vault and score its risk. Nothing is sent. " +
        "Costs 0.005 USDC, paid automatically from the agent wallet over x402.",
      inputSchema: paymentShape,
    },
    async (input) => {
      let calls: Call[];
      try {
        calls = toCalls(input, d.usdc);
      } catch (e) {
        return text({ outcome: "invalid", message: (e as Error).message }, true);
      }
      const res = await d.api.ask("check", calls);
      if (res.status !== 200) return guardianError(res.status, res.body);
      const r = checkResponseSchema.parse(res.body);
      return text({ outcome: "checked", ...summary(r), guardianFeeTx: res.paymentTx ?? null });
    },
  );

  server.registerTool(
    "pay",
    {
      title: "Pay from the vault",
      description:
        "Make a payment from the vault in one step: the Guardian checks and approves it (0.01 USDC fee over " +
        "x402), then the vault executes it with the agent wallet. If the Guardian or the vault would refuse, " +
        "nothing is sent and the reasons are returned. Pass `to` + `amount` (+ `token`), or raw `calls`.",
      inputSchema: paymentShape,
    },
    async (input) => {
      let calls: Call[];
      try {
        calls = toCalls(input, d.usdc);
      } catch (e) {
        return text({ outcome: "invalid", message: (e as Error).message }, true);
      }
      const me = await d.api.me();
      if (me.vaultPaused) return text({ outcome: "blocked", reasons: ["The owner locked the vault."] });
      if (me.isOnChainAgent === false)
        return text({ outcome: "blocked", reasons: ["This wallet is not the vault's agent."] });

      const res = await d.api.ask("cosign", calls);
      if (res.status !== 200) return guardianError(res.status, res.body);
      const r = checkResponseSchema.parse(res.body);
      const fee = res.paymentTx ? txUrl(res.paymentTx) : null;
      const maxRisk = me.rules?.maxRisk ?? "LOW";
      if (!r.verdict || RISK[r.risk] > RISK[maxRisk]) {
        return text({
          outcome: "blocked",
          by: "guardian",
          ...summary(r),
          maxRiskAllowed: maxRisk,
          guardianFee: fee,
          sent: false,
        });
      }
      const sim = await d.sender.simulate(me.vault, calls, r.verdict);
      if (sim.revert) {
        return text({
          outcome: "blocked",
          by: "vault",
          vaultError: sim.revert,
          ...summary(r),
          guardianFee: fee,
          sent: false,
        });
      }
      const sent = await d.sender.send(me.vault, calls, r.verdict);
      return text({
        outcome: sent.status === "success" ? "paid" : "reverted",
        tx: sent.tx,
        txUrl: txUrl(sent.tx),
        ...summary(r),
        guardianFee: fee,
      });
    },
  );

  server.registerTool(
    "get_transaction",
    {
      title: "Look up a transaction",
      description: "The verified outcome of a vault transaction: pending, executed or reverted. Free.",
      inputSchema: { hash: z.string().describe("transaction hash, 0x + 64 hex characters") },
    },
    async ({ hash }) => {
      try {
        return text(await d.api.transaction(hash));
      } catch (e) {
        return text({ outcome: "error", message: (e as Error).message }, true);
      }
    },
  );

  return server;
}
