#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = join(ROOT, ".env.local");
const DASHBOARD_ENV = join(ROOT, "apps/dashboard/.env.local");
const force = process.argv.includes("--force");

console.log("[setup] Initializing local environment...");

if (!existsSync(ENV_LOCAL) || force) {
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
  const dashboardConfig = [
    "# Public config for dashboard in local mode",
    "NEXT_PUBLIC_NETWORK=local",
    "NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545",
    "NEXT_PUBLIC_GUARDIAN_URL=http://127.0.0.1:4402",
    "NEXT_PUBLIC_AGENT_URL=http://127.0.0.1:4403",
    "",
  ].join("\n");
  writeFileSync(DASHBOARD_ENV, dashboardConfig);
  console.log(`[setup] Created apps/dashboard/.env.local for local mode.`);
} else {
  console.log(`[setup] apps/dashboard/.env.local already exists.`);
}

console.log("[setup] Environment files ready.");
