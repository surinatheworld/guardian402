// The agent-side MCP server: `pay` sends a transaction only when the Guardian approved it within the owner's
// maximum risk and the vault's own simulation passes; otherwise the agent gets the reasons and nothing is sent.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { getAddresses, type Call } from "@guardian402/shared";
import {
  AGENT_TOOL_NAMES,
  createAgentMcpServer,
  toCalls,
  type AgentApi,
  type AgentMe,
  type VaultSender,
} from "../src/agent-tools.ts";

const d = getAddresses("fuji");
const TREASURY = d.deployer;
const B32 = (c: string) => `0x${c.repeat(64)}` as Hex;

const response = (risk: "LOW" | "MEDIUM" | "HIGH", verdict = true) => ({
  checkId: B32("c"),
  risk,
  riskCode: { LOW: 0, MEDIUM: 1, HIGH: 2 }[risk],
  score: risk === "LOW" ? 0 : 90,
  findings:
    risk === "LOW"
      ? []
      : [
          {
            ruleId: "RECIPIENT_NOT_ALLOWLISTED",
            severity: "HIGH",
            title: "Recipient not allowlisted",
            evidence: {},
          },
        ],
  simulation: { success: true, gasUsed: "1", forkBlock: "1" },
  diff: { tokenDeltas: [], nativeDelta: "0", approvals: [], transfers: [] },
  explanation: { vi: "Rủi ro", en: "Risk", source: "template" },
  ...(verdict
    ? {
        verdict: {
          callsHash: B32("a"),
          nonce: "0",
          deadline: 1,
          risk: { LOW: 0, MEDIUM: 1, HIGH: 2 }[risk],
          checkId: B32("c"),
          signature: `0x${"11".repeat(65)}`,
        },
      }
    : {}),
  latencyMs: 1,
  demoMode: false,
});

function setup(
  opts: { risk?: "LOW" | "MEDIUM" | "HIGH"; revert?: string; me?: Partial<AgentMe>; status?: number } = {},
) {
  const asked: { endpoint: string; calls: Call[] }[] = [];
  const sent: Call[][] = [];
  const me: AgentMe = {
    vault: d.vault,
    isOnChainAgent: true,
    vaultPaused: false,
    guideline: ["You may only send money to these addresses: Treasury."],
    rules: { maxRisk: "LOW", tokens: [] },
    ...opts.me,
  };
  const api: AgentApi = {
    me: async () => me,
    ask: async (endpoint, calls) => {
      asked.push({ endpoint, calls });
      if (opts.status && opts.status !== 200)
        return { status: opts.status, body: { message: "Guardian busy" } };
      return { status: 200, body: response(opts.risk ?? "LOW"), paymentTx: B32("f") };
    },
    transaction: async (hash) => ({ found: true, hash }),
  };
  const sender: VaultSender = {
    simulate: async () => (opts.revert ? { revert: opts.revert } : {}),
    send: async (_vault, calls) => {
      sent.push(calls);
      return { tx: B32("e"), status: "success" };
    },
  };
  return { asked, sent, server: createAgentMcpServer({ api, sender, usdc: d.usdc }) };
}

async function connect(server: ReturnType<typeof setup>["server"]) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-agent", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const result = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}") as Record<string, unknown>;

describe("agent MCP tools", () => {
  it("lists the four tools", async () => {
    const client = await connect(setup().server);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("builds a USDC transfer, an AVAX transfer, or takes raw calls", () => {
    const [usdc] = toCalls({ to: TREASURY, amount: "1.5" }, d.usdc);
    expect(usdc?.target).toBe(d.usdc);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: usdc?.data ?? "0x" });
    expect(decoded.args).toEqual([TREASURY, 1_500_000n]);
    expect(toCalls({ to: TREASURY, amount: "0.01", token: "AVAX" }, d.usdc)).toEqual([
      { target: TREASURY, value: 10_000_000_000_000_000n, data: "0x" },
    ]);
    expect(toCalls({ calls: [{ target: d.router, value: "5", data: "0xabcd" }] }, d.usdc)).toEqual([
      { target: d.router, value: 5n, data: "0xabcd" },
    ]);
    expect(() => toCalls({ to: "nope", amount: "1" }, d.usdc)).toThrow(/recipient address/);
    expect(() => toCalls({ to: TREASURY, amount: "1,5" }, d.usdc)).toThrow(/amount/);
  });

  it("get_rules returns the guideline", async () => {
    const client = await connect(setup().server);
    const r = result(await client.callTool({ name: "get_rules", arguments: {} }));
    expect(r.guideline).toEqual(["You may only send money to these addresses: Treasury."]);
    expect(r.youAreTheVaultAgent).toBe(true);
  });

  it("pay: approved LOW risk is executed by the vault", async () => {
    const s = setup();
    const client = await connect(s.server);
    const r = result(await client.callTool({ name: "pay", arguments: { to: TREASURY, amount: "1.5" } }));
    expect(r).toMatchObject({ outcome: "paid", risk: "LOW", tx: B32("e") });
    expect(s.asked.map((a) => a.endpoint)).toEqual(["cosign"]);
    expect(s.sent).toHaveLength(1);
  });

  it("pay: risk above the owner's maximum is not sent", async () => {
    const s = setup({ risk: "HIGH" });
    const client = await connect(s.server);
    const r = result(await client.callTool({ name: "pay", arguments: { to: TREASURY, amount: "40" } }));
    expect(r).toMatchObject({ outcome: "blocked", by: "guardian", risk: "HIGH", sent: false });
    expect(r.reasons).toEqual(["Recipient not allowlisted"]);
    expect(s.sent).toHaveLength(0);
  });

  it("pay: a vault rule that would revert is not sent", async () => {
    const s = setup({ revert: "BudgetExceeded" });
    const client = await connect(s.server);
    const r = result(await client.callTool({ name: "pay", arguments: { to: TREASURY, amount: "1" } }));
    expect(r).toMatchObject({ outcome: "blocked", by: "vault", vaultError: "BudgetExceeded", sent: false });
    expect(s.sent).toHaveLength(0);
  });

  it("pay: a locked vault or a wallet that is not the agent asks nothing and sends nothing", async () => {
    for (const me of [{ vaultPaused: true }, { isOnChainAgent: false }]) {
      const s = setup({ me });
      const client = await connect(s.server);
      const r = result(await client.callTool({ name: "pay", arguments: { to: TREASURY, amount: "1" } }));
      expect(r.outcome).toBe("blocked");
      expect(s.asked).toHaveLength(0);
      expect(s.sent).toHaveLength(0);
    }
  });

  it("a Guardian error is reported as not charged, and check_payment never sends", async () => {
    const busy = setup({ status: 503 });
    let client = await connect(busy.server);
    const r = await client.callTool({ name: "pay", arguments: { to: TREASURY, amount: "1" } });
    expect(r.isError).toBe(true);
    expect(result(r)).toMatchObject({ outcome: "error", status: 503, charged: false });

    const s = setup({ risk: "LOW" });
    client = await connect(s.server);
    const c = result(
      await client.callTool({ name: "check_payment", arguments: { to: TREASURY, amount: "1" } }),
    );
    expect(c).toMatchObject({ outcome: "checked", risk: "LOW" });
    expect(s.asked.map((a) => a.endpoint)).toEqual(["check"]);
    expect(s.sent).toHaveLength(0);
  });
});
