// Deployed addresses keyed by NETWORK (local | fuji), written by `pnpm deploy:<network>`.
import { z } from "zod";
import { FUJI_CHAIN_ID } from "./constants.ts";
import { addressSchema } from "./schemas.ts";
import fujiJson from "./addresses/fuji.json" with { type: "json" };
import localJson from "./addresses/local.json" with { type: "json" };

export const NETWORKS = ["local", "fuji"] as const;
export type Network = (typeof NETWORKS)[number];

export const deploymentSchema = z.object({
  network: z.enum(NETWORKS),
  chainId: z.literal(FUJI_CHAIN_ID),
  startBlock: z.number().int().nonnegative(),
  deployer: addressSchema,
  owner: addressSchema,
  usdc: addressSchema,
  mWAVAX: addressSchema,
  oracle: addressSchema,
  router: addressSchema,
  vault: addressSchema,
  cancunSmoke: addressSchema.optional(),
  // AgentVault replaced by `pnpm redeploy-vault:<network>` (emptied and paused).
  previousVault: addressSchema.optional(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

const deployments: Record<Network, Deployment> = {
  local: deploymentSchema.parse(localJson),
  fuji: deploymentSchema.parse(fujiJson),
};

export function parseNetwork(value: string | undefined): Network {
  const network = value ?? "local";
  if (!(NETWORKS as readonly string[]).includes(network)) {
    throw new Error(`NETWORK must be one of ${NETWORKS.join(", ")}, got "${network}"`);
  }
  return network as Network;
}

export function getAddresses(network: Network): Deployment {
  return deployments[network];
}
