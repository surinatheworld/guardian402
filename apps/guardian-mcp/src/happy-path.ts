// `pnpm happy-path:fuji`: the whole happy path on Avalanche Fuji, end to end, with the project's test keys.
//
//   owner (OWNER_PK)   creates a vault through the VaultFactory with its rules (1 recipient, 20 USDC/day,
//                      2 USDC per payment, 3 USDC in total, LOW risk only) and deposits 6 USDC
//   dashboard          the owner signs in with the wallet (SIWE), links the vault, the agent and the recipient's
//                      name, and issues an API key — the same calls /bat-dau makes
//   agent (AGENT_PK)   runs the agent MCP server (`pnpm mcp:agent`) and asks it, like an AI agent would:
//                      get_rules · pay 1 USDC (paid) · pay 2.5 USDC (blocked: per payment) ·
//                      pay 2 USDC (paid) · pay 0.5 USDC (blocked: total budget used)
//
// Needs the Guardian (NETWORK=fuji) on GUARDIAN_URL behind the dashboard on DASHBOARD_URL (default
// http://localhost:3000), and a little AVAX on OWNER_PK and AGENT_PK. Each run creates a new vault and spends
// 6 USDC from the owner into the new vault (topped up from AGENT_PK when short) plus ~0.04 USDC of Guardian fees.
// Exits 1 when an outcome differs from the plan above.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import {
  agentVaultAbi,
  fujiChain,
  getAddresses,
  rpcTransport,
  txUrl,
  vaultFactoryAbi,
} from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
const need = (k: string) => {
  const v = process.env[k];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${k} is missing in .env.local`);
  return v as Hex;
};
const d = getAddresses("fuji");
if (!d.factory) throw new Error("no VaultFactory in addresses/fuji.json: run pnpm deploy-factory:fuji");
const factory = d.factory;
const owner = privateKeyToAccount(need("OWNER_PK"));
const agent = privateKeyToAccount(need("AGENT_PK"));
const rpc = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const DASHBOARD = (process.env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
const chain = createPublicClient({ chain: fujiChain, transport: rpcTransport(rpc) });
const ownerWallet = createWalletClient({ account: owner, chain: fujiChain, transport: rpcTransport(rpc) });
const agentWallet = createWalletClient({ account: agent, chain: fujiChain, transport: rpcTransport(rpc) });
const usdc = (n: number) => parseUnits(String(n), 6);
const treasury = d.deployer;

let failures = 0;
const say = (s: string) => console.log(s);
const expect = (ok: boolean, what: string) => {
  say(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

async function send(hash: Hex) {
  const r = await chain.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`transaction reverted: ${txUrl(hash)}`);
  return r;
}

// ------------------------------------------------------------------ dashboard session

let cookie = "";
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${DASHBOARD}${path}`, {
    method,
    headers: {
      origin: DASHBOARD,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${json.message ?? ""}`);
  return json;
}

// ------------------------------------------------------------------ run

say(`[happy path] Fuji · factory ${factory} · dashboard ${DASHBOARD}`);

const resume = process.env.HAPPY_PATH_VAULT as Address | undefined;
let vault: Address;
if (resume) {
  vault = resume;
  say(`\n1–2. Dùng lại két ${vault} (HAPPY_PATH_VAULT)`);
} else {
  say("\n1. Chủ két tạo két qua VaultFactory");
  const ownerUsdc = await chain.readContract({
    address: d.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });
  if (ownerUsdc < usdc(6)) {
    const topUp = usdc(6) - ownerUsdc;
    say(
      `  ví chủ có ${formatUnits(ownerUsdc, 6)} USDC: chuyển ${formatUnits(topUp, 6)} USDC từ ví agent sang`,
    );
    await send(
      await agentWallet.writeContract({
        address: d.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [owner.address, topUp],
      }),
    );
  }
  const created = await send(
    await ownerWallet.writeContract({
      address: factory,
      abi: vaultFactoryAbi,
      functionName: "createVault",
      args: [
        agent.address,
        {
          maxAgentRisk: 0,
          tokens: [
            {
              token: d.usdc,
              dailyCap: usdc(20),
              maxApproval: 0n,
              verdictThreshold: 0n,
              maxPerTx: usdc(2),
              budget: usdc(3),
            },
          ],
          nativeDailyCap: 0n,
          nativeVerdictThreshold: 0n,
          nativeMaxPerTx: 0n,
          nativeBudget: 0n,
          targets: [],
          recipients: [treasury],
        },
      ],
    }),
  );
  const [event] = parseEventLogs({ abi: vaultFactoryAbi, logs: created.logs, eventName: "VaultCreated" });
  if (!event) throw new Error("no VaultCreated event");
  vault = event.args.vault;
  say(`  két ${vault} · ${txUrl(created.transactionHash)}`);

  // 6 USDC in the vault, 3 USDC of budget: each payment stays under the Guardian's drain rule (50% of balance).
  say("\n2. Chủ két nạp 6 USDC vào két");
  const deposit = await send(
    await ownerWallet.writeContract({
      address: d.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [vault, usdc(6)],
    }),
  );
  say(`  ${txUrl(deposit.transactionHash)}`);
}

say("\n3. Dashboard: đăng nhập bằng ví chủ (SIWE), liên kết két, agent, khoá API");
const { nonce, chainId } = await api<{ nonce: string; chainId: number }>("/api/auth/siwe/nonce", "POST", {});
const issuedAt = new Date();
const message = createSiweMessage({
  domain: new URL(DASHBOARD).host,
  address: owner.address,
  statement: "Đăng nhập Guardian402 bằng ví này. Ký thông điệp không tốn phí và không gửi giao dịch nào.",
  uri: DASHBOARD,
  version: "1",
  chainId,
  nonce,
  issuedAt,
  expirationTime: new Date(issuedAt.getTime() + 5 * 60_000),
});
await api("/api/auth/siwe/verify", "POST", { message, signature: await owner.signMessage({ message }) });
await api("/api/account/vaults", "POST", { address: vault, label: "Két happy path" });
const { agent: row } = await api<{ agent: { id: number } }>(`/api/vaults/${vault}/agents`, "POST", {
  name: "Agent happy path",
  address: agent.address,
});
await api(`/api/vaults/${vault}/contacts`, "POST", { name: "Treasury", address: treasury });
const { key } = await api<{ key: string }>(`/api/vaults/${vault}/agents/${row.id}/keys`, "POST", {
  name: "happy path",
});
say(`  khoá API ${key.slice(0, 11)}… cho agent ${agent.address}`);

say("\n4. Agent dùng MCP server (pnpm mcp:agent)");
const mcp = new Client({ name: "happy-path-agent", version: "0" });
await mcp.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(dirname(fileURLToPath(import.meta.url)), "agent-main.ts")],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
      ),
      GUARDIAN_API_URL: `${DASHBOARD}/api/agent/v1`,
      GUARDIAN_API_KEY: key,
      AGENT_PK: need("AGENT_PK"),
      CHAIN_RPC_URL: rpc,
    },
    stderr: "inherit",
  }),
);
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await mcp.callTool({ name, arguments: args });
  return JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}") as Record<string, unknown>;
};

const rules = await call("get_rules", {});
say("  get_rules:");
for (const line of (rules.guideline as string[]) ?? []) say(`    · ${line}`);
expect(rules.youAreTheVaultAgent === true, "agent là agent của két");

const plan: [number, "paid" | "blocked", string][] = [
  [1, "paid", "trả 1 USDC cho Treasury"],
  [2.5, "blocked", "2,5 USDC vượt hạn mức 2 USDC mỗi giao dịch"],
  [2, "paid", "trả 2 USDC (dùng hết tổng 3 USDC)"],
  [0.5, "blocked", "0,5 USDC sau khi đã dùng hết tổng ngân sách"],
];
for (const [amount, want, what] of plan) {
  const r = await call("pay", { to: treasury, amount: String(amount) });
  const detail =
    r.outcome === "paid"
      ? String(r.txUrl)
      : r.outcome === "blocked"
        ? `${String(r.by ?? "")}: ${[r.vaultError, ...((r.reasons as string[]) ?? [])].filter(Boolean).join("; ")}`
        : JSON.stringify(r);
  say(`  pay ${amount} USDC → ${String(r.outcome)} (${String(r.risk ?? "?")}) ${detail}`);
  expect(r.outcome === want, what);
}
await mcp.close();

say("\n5. Két sau cùng");
const [balance, left] = await Promise.all([
  chain.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
  chain.readContract({ address: vault, abi: agentVaultAbi, functionName: "remainingBudget", args: [d.usdc] }),
]);
say(`  số dư ${formatUnits(balance, 6)} USDC · ngân sách còn ${formatUnits(left, 6)} USDC`);
expect(left === 0n, "agent đã chi đúng 3 USDC và dừng ở tổng ngân sách");
say(failures ? `\n✗ ${failures} kết quả lệch kế hoạch` : "\n✓ happy path khớp kế hoạch");
process.exit(failures ? 1 : 0);
