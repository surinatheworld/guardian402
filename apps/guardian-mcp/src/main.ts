// `pnpm mcp`: the Guardian as a paid MCP server over stdio (bonus B2, docs/SPEC.md §13.2), for any MCP client
// (Claude Desktop, Claude Code, an agent framework). Same env as the Guardian API (repo-root .env.local).
//
// The fork: one fork serves one Guardian process (simulations take snapshots on it). With the Guardian API
// running, give the MCP server a second fork: `FORK_PORT=8546 pnpm fork`, then MCP_FORK_RPC_URL=
// http://127.0.0.1:8546. Its check history goes to GUARDIAN_MCP_DB (default apps/guardian/data/guardian-mcp.db).
// Logs go to stderr: stdout carries the MCP protocol.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { destination, pino } from "pino";
import { createGuardianCore } from "@guardian402/guardian/core";
import { loadEnv } from "@guardian402/guardian/env";
import { createResourceServer } from "@guardian402/guardian/x402";
import { txUrl } from "@guardian402/shared";
import { createGuardianMcpServer } from "./tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// Overrides first: .env.local never replaces a variable that is already set.
if (process.env.MCP_FORK_RPC_URL) process.env.FORK_RPC_URL = process.env.MCP_FORK_RPC_URL;
process.env.GUARDIAN_DB = process.env.GUARDIAN_MCP_DB || "apps/guardian/data/guardian-mcp.db";
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));

const log = pino(
  { redact: ["*.GUARDIAN_SIGNER_PK", "*.LLM_API_KEY", "*.signature", "*.paymentHeader"] },
  destination(2),
);
const env = loadEnv();

// Refuse to share a fork with a running Guardian API: two processes snapshotting one fork corrupt each other.
const api = await fetch(`http://127.0.0.1:${env.GUARDIAN_PORT}/v1/health`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (api && !process.env.MCP_FORK_RPC_URL) {
  log.error(
    "A Guardian API is running on this machine and probably uses the same fork. Start a second fork " +
      "(FORK_PORT=8546 pnpm fork) and set MCP_FORK_RPC_URL=http://127.0.0.1:8546.",
  );
  process.exit(1);
}

const core = createGuardianCore(env, log);
await core.start();
const resourceServer = createResourceServer({
  facilitatorUrl: env.FACILITATOR_URL,
  log: (l) => log.info(l, "x402"),
});
await resourceServer.initialize();

const server = await createGuardianMcpServer({
  pipeline: core.pipeline,
  resourceServer,
  payTo: env.PAY_TO,
  onSettled: (s) => {
    core.store.insertPayment({
      payer: s.payer,
      amount: s.amount,
      txHash: s.transaction as `0x${string}`,
      endpoint: s.tool === "cosign_transaction" ? "cosign" : "check",
      checkId: s.checkId,
    });
    log.info(
      { tool: s.tool, amount: s.amount, tx: txUrl(s.transaction as `0x${string}`) },
      "mcp payment settled",
    );
  },
});
await server.connect(new StdioServerTransport());
log.info(
  { network: env.NETWORK, vault: core.deployment.vault, fork: env.FORK_RPC_URL },
  "Guardian MCP server ready",
);
