// The packaged server starts like `npx guardian402-mcp` would run it: over stdio, with the three settings, and
// offers the four agent tools. It refuses to start without them. No network: listing tools makes no call.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const bin = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const env = {
  GUARDIAN_API_URL: "http://127.0.0.1:9/api/agent/v1",
  GUARDIAN_API_KEY: "g402_" + "a".repeat(32),
  AGENT_PK: "0x" + "11".repeat(32),
};

test("lists the four agent tools over stdio", async () => {
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { ...process.env, ...env },
      stderr: "ignore",
    }),
  );
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["check_payment", "get_rules", "get_transaction", "pay"]);
  await client.close();
});

test("refuses to start without its settings", () => {
  const r = spawnSync(process.execPath, [bin], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GUARDIAN_API_URL is missing/);
});
