#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = join(ROOT, ".env.local");
const DASHBOARD_ENV = join(ROOT, "apps/dashboard/.env.local");
const force = process.argv.includes("--force");

console.log("[setup] Initializing local environment...");

// Never lose keys: --force keeps a timestamped copy of the old file (it may hold the team's Fuji keys).
const backup = (file) => {
  if (!existsSync(file)) return;
  const copy = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, copy);
  console.log(`[setup] Kept the previous file as ${copy}`);
};

if (!existsSync(ENV_LOCAL) || force) {
  backup(ENV_LOCAL);
  const deployerPk = generatePrivateKey();
  const ownerPk = generatePrivateKey();
  const agentPk = generatePrivateKey();
  const guardianSignerPk = generatePrivateKey();
  const facilitatorPk = generatePrivateKey();
  const deployer = privateKeyToAccount(deployerPk);

  let template = readFileSync(join(ROOT, ".env.example"), "utf8");

  template = template
    .replace(/^NETWORK=.*$/m, "NETWORK=local")
    .replace(/^DEPLOYER_PK=.*$/m, `DEPLOYER_PK=${deployerPk}`)
    .replace(/^OWNER_PK=.*$/m, `OWNER_PK=${ownerPk}`)
    .replace(/^AGENT_PK=.*$/m, `AGENT_PK=${agentPk}`)
    .replace(/^GUARDIAN_SIGNER_PK=.*$/m, `GUARDIAN_SIGNER_PK=${guardianSignerPk}`)
    .replace(/^FACILITATOR_PK=.*$/m, `FACILITATOR_PK=${facilitatorPk}`)
    .replace(/^PAY_TO=.*$/m, `PAY_TO=${deployer.address}`)
    .replace(/^FACILITATOR_URL=.*$/m, "FACILITATOR_URL=http://127.0.0.1:4022")
    .replace(/^FACILITATOR_RPC_URL=.*$/m, "FACILITATOR_RPC_URL=http://127.0.0.1:8545");

  writeFileSync(ENV_LOCAL, template);
  console.log(`[setup] Created .env.local with fresh testnet keys.`);
  console.log(`        Deployer / PayTo: ${deployer.address}`);
} else {
  console.log(`[setup] .env.local already exists (skipping, use --force to regenerate).`);
}

if (!existsSync(DASHBOARD_ENV) || force) {
  backup(DASHBOARD_ENV);
  const dashboardConfig = [
    "# Public config for dashboard in local mode",
    "NEXT_PUBLIC_NETWORK=local",
    "# Empty URLs: this host's browser uses 127.0.0.1, other machines (public tunnel) the same-origin proxy",
    "# /api/rpc, /api/guardian, /api/agent-control. Set one only for a service with its own public URL.",
    "NEXT_PUBLIC_RPC_URL=",
    "NEXT_PUBLIC_GUARDIAN_URL=",
    "NEXT_PUBLIC_AGENT_URL=",
    "",
  ].join("\n");
  writeFileSync(DASHBOARD_ENV, dashboardConfig);
  console.log(`[setup] Created apps/dashboard/.env.local for local mode.`);
} else {
  console.log(`[setup] apps/dashboard/.env.local already exists.`);
}

console.log("[setup] Environment files ready.");
