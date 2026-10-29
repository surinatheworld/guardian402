// Shared setup for *.fork.test.ts: needs `pnpm fork` running. Reuses the deploy and seed scripts so the local
// deployment exists and is seeded (SPEC §4.8) before any test runs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, erc20Abi, getAddress, http, type Address, type PublicClient } from "viem";
import { deploymentSchema, FUJI_RPC_URL, fujiChain, type Deployment } from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
export const FORK_RPC_URL = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
/** Fuji RPC the fork is reset from; `FUJI_RPC_URL` in `.env.local` overrides the rate-limited public one. */
export const UPSTREAM_RPC_URL = process.env.FUJI_RPC_URL || FUJI_RPC_URL;

export type ForkEnv = { addresses: Deployment; client: PublicClient };

function readLocal(): Deployment {
  return deploymentSchema.parse(
    JSON.parse(readFileSync(join(ROOT, "packages/shared/src/addresses/local.json"), "utf8")),
  );
}

async function isSeeded(client: PublicClient, a: Deployment): Promise<boolean> {
  if (!(await client.getCode({ address: a.vault }))) return false;
  const [usdc, agent] = await Promise.all([
    client.readContract({ address: a.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a.vault] }),
    client.readContract({
      address: a.vault,
      abi: [
        {
          type: "function",
          name: "agent",
          inputs: [],
          outputs: [{ type: "address" }],
          stateMutability: "view",
        },
      ],
      functionName: "agent",
    }),
  ]);
  return usdc >= 10_000_000n && agent !== "0x0000000000000000000000000000000000000000";
}

export async function setupFork(): Promise<ForkEnv> {
  const client = createPublicClient({ chain: fujiChain, transport: http(FORK_RPC_URL) });
  const chainId = await client.getChainId().catch(() => {
    throw new Error(`no Anvil fork at ${FORK_RPC_URL}: start it with \`pnpm fork\``);
  });
  if (chainId !== 43113) throw new Error(`fork chain id is ${chainId}, expected 43113`);
  // Start from a clean fork at the latest Fuji block: an earlier run that died mid-simulation may have left
  // its snapshot unreverted. The local addresses equal the Fuji ones, so the seeded Fuji vault is used.
  await client.request({
    method: "anvil_reset",
    params: [{ forking: { jsonRpcUrl: UPSTREAM_RPC_URL } }],
  } as never);
  await client.request({ method: "evm_setAutomine", params: [true] } as never);
  let addresses = readLocal();
  if (!(await isSeeded(client, addresses))) {
    const run = (action: string) =>
      execFileSync(process.execPath, [join(ROOT, "scripts/contracts.mjs"), action, "local"], {
        cwd: ROOT,
        stdio: "ignore",
      });
    run("deploy");
    run("seed");
    addresses = readLocal();
  }
  return { addresses, client };
}

export const ATTACKER: Address = getAddress("0x000000000000000000000000000000000000a77a");
