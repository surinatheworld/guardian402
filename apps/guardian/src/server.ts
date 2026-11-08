// `pnpm dev:guardian`: the Guardian API (docs/SPEC.md §6). NETWORK=local runs against the Anvil fork only;
// NETWORK=fuji reads the vault on Fuji and simulates on the fork, which is reset from Fuji in the background.
import { pino } from "pino";
import { createApp } from "./app.ts";
import { createGuardianCore } from "./core.ts";
import { loadEnv } from "./env.ts";
import { defaultRuleConfig } from "./rules/index.ts";

// Never log keys or payment signatures (pino redaction as a second line of defence).
const log = pino({ redact: ["*.GUARDIAN_SIGNER_PK", "*.LLM_API_KEY", "*.signature", "*.paymentHeader"] });
const env = loadEnv();
const core = createGuardianCore(env, log);
const { deployment, simulator } = core;

await core.start();

const app = createApp({
  pipeline: core.pipeline,
  store: core.store,
  ruleConfig: defaultRuleConfig,
  deployment,
  signerAddress: core.signerAddress,
  payTo: env.PAY_TO,
  demoMode: env.DEMO_MODE,
  dashboardOrigin: env.DASHBOARD_ORIGIN,
  busy: () => simulator.queueDepth >= env.MAX_QUEUED_CHECKS,
  allowedHosts: new Set(
    env.ALLOWED_HOSTS
      ? env.ALLOWED_HOSTS.split(",").map((h) => h.trim().toLowerCase())
      : ["127.0.0.1", "localhost", "[::1]"].map((h) => `${h}:${env.GUARDIAN_PORT}`),
  ),
  resourceServer: core.resourceServer,
  forkBlock: () => core.fork.getBlockNumber(),
  log,
});

app.listen(env.GUARDIAN_PORT, "127.0.0.1", () => {
  log.info(
    {
      port: env.GUARDIAN_PORT,
      network: env.NETWORK,
      vault: deployment.vault,
      signer: core.signerAddress,
      facilitator: env.FACILITATOR_URL,
      demoMode: env.DEMO_MODE,
    },
    "Guardian API listening",
  );
});
