// `pnpm dev:guardian`: the Guardian API (docs/SPEC.md §6). NETWORK=local runs against the Anvil fork only;
// NETWORK=fuji reads the vault on Fuji and simulates on the fork, which is reset from Fuji in the background.
import { createPublicClient, encodeFunctionData, erc20Abi, http } from "viem";
import { pino } from "pino";
import { fujiChain, getAddresses, mockRouterAbi, type Call } from "@guardian402/shared";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createExplainer } from "./explain/index.ts";
import { Pipeline } from "./pipeline.ts";
import { defaultRuleConfig, loadKnownContracts } from "./rules/index.ts";
import { createSigner } from "./sign/index.ts";
import { Simulator } from "./sim/index.ts";
import { Store } from "./store.ts";
import { createResourceServer } from "./x402.ts";

// Never log keys or payment signatures (pino redaction as a second line of defence).
const log = pino({ redact: ["*.GUARDIAN_SIGNER_PK", "*.LLM_API_KEY", "*.signature", "*.paymentHeader"] });
const env = loadEnv();
const deployment = getAddresses(env.NETWORK);
const chain = createPublicClient({ chain: fujiChain, transport: http(env.CHAIN_RPC_URL) });
const fork = createPublicClient({ chain: fujiChain, transport: http(env.FORK_RPC_URL) });
// A typical batch (S1) simulated after every fork reset, so the first real check does not pay for a cold cache.
const warmCalls: Call[] = [
  {
    target: deployment.usdc,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deployment.router, 1n] }),
  },
  {
    target: deployment.router,
    value: 0n,
    data: encodeFunctionData({
      abi: mockRouterAbi,
      functionName: "swapExactIn",
      args: [deployment.usdc, deployment.mWAVAX, 1n, 0n, 0, deployment.vault],
    }),
  },
];
const warmUp = () => {
  void simulator
    .simulate(deployment.vault, warmCalls)
    .then((r) => log.info({ ms: Math.round(r.durationMs), ok: r.success }, "fork warm-up"));
};
const simulator: Simulator = new Simulator({
  forkRpcUrl: env.FORK_RPC_URL,
  ...(env.NETWORK === "fuji" ? { upstreamRpcUrl: env.FUJI_RPC_URL } : {}),
  knownTokens: [deployment.usdc, deployment.mWAVAX],
  onMaintenanceError: (e) => log.warn({ err: (e as Error).message }, "fork maintenance failed"),
  onReset: () => warmUp(),
});
const store = new Store(env.GUARDIAN_DB);
const signer = createSigner(env.GUARDIAN_SIGNER_PK);
const explainer = createExplainer({
  LLM_PROVIDER: env.LLM_PROVIDER,
  LLM_MODEL: env.LLM_MODEL,
  LLM_API_KEY: env.LLM_API_KEY,
  onFallback: (reason) => log.info({ reason }, "explainer fell back to the template"),
});
const pipeline = new Pipeline({
  chain,
  simulator,
  explainer,
  signer,
  store,
  deployment,
  knownContracts: loadKnownContracts(env.NETWORK),
  demoMode: env.DEMO_MODE,
});
const resourceServer = createResourceServer({
  facilitatorUrl: env.FACILITATOR_URL,
  store,
  log: (line) => log.info(line, "x402"),
});

await simulator.ensureForkHealthy(deployment.vault);
simulator.start();
warmUp();

const app = createApp({
  pipeline,
  store,
  ruleConfig: defaultRuleConfig,
  deployment,
  signerAddress: signer.address,
  payTo: env.PAY_TO,
  demoMode: env.DEMO_MODE,
  dashboardOrigin: env.DASHBOARD_ORIGIN,
  resourceServer,
  forkBlock: () => fork.getBlockNumber(),
  log,
});

app.listen(env.GUARDIAN_PORT, "127.0.0.1", () => {
  log.info(
    {
      port: env.GUARDIAN_PORT,
      network: env.NETWORK,
      vault: deployment.vault,
      signer: signer.address,
      facilitator: env.FACILITATOR_URL,
      demoMode: env.DEMO_MODE,
    },
    "Guardian API listening",
  );
});
