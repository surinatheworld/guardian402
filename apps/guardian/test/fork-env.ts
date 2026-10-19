// Shared setup for *.fork.test.ts: needs `pnpm fork` running. Reuses the deploy and seed scripts so the local
// deployment exists and is seeded (SPEC §4.8) before any test runs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, erc20Abi, getAddress, http, type Address, type PublicClient } from "viem";
import { deploymentSchema, fujiChain, type Deployment } from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FORK_RPC_URL = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";

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
