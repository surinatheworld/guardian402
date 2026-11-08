// The Guardian's parts, wired once (P14): chain and fork clients, simulator with warm-up, store, signer,
// explainer, pipeline and the x402 resource server. Used by the HTTP API (`src/server.ts`) and, as a library,
// by the MCP server (`apps/guardian-mcp`, bonus B2), so both run the same checks with the same prices.
import { createPublicClient, encodeFunctionData, erc20Abi, http, type PublicClient } from "viem";
import type { Logger } from "pino";
import {
  fujiChain,
  getAddresses,
  mockRouterAbi,
  rpcTransport,
  type Call,
  type Deployment,
} from "@guardian402/shared";
import type { Env } from "./env.ts";
import { createExplainer } from "./explain/index.ts";
import { Pipeline } from "./pipeline.ts";
import { loadKnownContracts } from "./rules/index.ts";
import { createSigner } from "./sign/index.ts";
import { Simulator } from "./sim/index.ts";
import { Store } from "./store.ts";
import { createResourceServer } from "./x402.ts";

export type GuardianCore = {
  env: Env;
  deployment: Deployment;
  chain: PublicClient;
  fork: PublicClient;
  simulator: Simulator;
  store: Store;
  signerAddress: `0x${string}`;
  pipeline: Pipeline;
  resourceServer: ReturnType<typeof createResourceServer>;
  /** Fork health check, background maintenance and the first warm-up. */
  start: () => Promise<void>;
};

export function createGuardianCore(env: Env, log: Logger): GuardianCore {
  const deployment = getAddresses(env.NETWORK);
  const chain = createPublicClient({
    chain: fujiChain,
    transport: rpcTransport(env.CHAIN_RPC_URL),
  }) as PublicClient;
  const fork = createPublicClient({ chain: fujiChain, transport: http(env.FORK_RPC_URL) }) as PublicClient;
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
  return {
    env,
    deployment,
    chain,
    fork,
    simulator,
    store,
    signerAddress: signer.address,
    pipeline,
    resourceServer,
    start: async () => {
      await simulator.ensureForkHealthy(deployment.vault);
      simulator.start();
      warmUp();
    },
  };
}
