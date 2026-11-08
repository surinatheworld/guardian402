// ERC-8004 identity of the Guardian (docs/SPEC.md §13.1, bonus B1). The registration file format follows
// ERC8004SPEC.md of the official erc-8004/erc-8004-contracts repository ("registration-v1").
import { z } from "zod";
import type { Address } from "viem";
import { FUJI_CHAIN_ID, PRICES } from "../constants.ts";
import { addressSchema } from "../schemas.ts";
import record from "../addresses/erc8004.fuji.json" with { type: "json" };

export const ERC8004_REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
/** Official ERC-8004 registries on Avalanche Fuji (listed as "Avalanche Testnet" in the official README). */
export const ERC8004_FUJI = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const satisfies Record<string, Address>;
export const GUARDIAN_REPO_URL = "https://github.com/surinatheworld/guardian402";

/** `{namespace}:{chainId}:{identityRegistry}`, the agentRegistry field of a registration. */
export const agentRegistryId = (chainId: number, registry: Address) => `eip155:${chainId}:${registry}`;

export const registrationSchema = z.object({
  type: z.literal(ERC8004_REGISTRATION_TYPE),
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url().optional(),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        endpoint: z.string().min(1),
        version: z.string().min(1).optional(),
      }),
    )
    .min(1),
  x402Support: z.boolean(),
  active: z.boolean(),
  // "Agents SHOULD have at least one registration ... and all fields in the registration are mandatory."
  registrations: z
    .array(
      z.object({
        agentId: z.number().int().nonnegative(),
        agentRegistry: z.string().regex(/^eip155:\d+:0x[0-9a-fA-F]{40}$/),
      }),
    )
    .min(1),
  supportedTrust: z.array(z.string()).optional(),
});
export type Registration = z.infer<typeof registrationSchema>;

const usdc = (atomic: string) => `${Number(atomic) / 1e6} USDC`;

/** The Guardian's registration file. `endpoint` is the public base URL of the Guardian API, if there is one. */
export function guardianRegistration(agentId: number, endpoint?: string): Registration {
  const api = endpoint?.replace(/\/$/, "");
  return registrationSchema.parse({
    type: ERC8004_REGISTRATION_TYPE,
    name: "Guardian402",
    description:
      "Transaction firewall and co-signer for AI-agent wallets on Avalanche Fuji (testnet). Before an agent's " +
      "batch runs, the Guardian simulates it on a fork, scores it with 8 deterministic rules, explains the result " +
      "in Vietnamese and English, and signs an EIP-712 verdict that the owner's AgentVault checks on-chain. " +
      `Paid per request over x402 in USDC: POST /v1/check ${usdc(PRICES.check)}, POST /v1/cosign ${usdc(PRICES.cosign)}. ` +
      "Hackathon project, testnet only.",
    services: [
      api ? { name: "web", endpoint: `${api}/v1/health` } : { name: "web", endpoint: GUARDIAN_REPO_URL },
    ],
    x402Support: true,
    active: true,
    registrations: [
      { agentId, agentRegistry: agentRegistryId(FUJI_CHAIN_ID, ERC8004_FUJI.identityRegistry) },
    ],
  });
}

/** On-chain agentURI: the registration file inline as base64 JSON, so no hosting is needed. */
export function toDataUri(registration: Registration): string {
  const bytes = new TextEncoder().encode(JSON.stringify(registration));
  return `data:application/json;base64,${btoa(String.fromCharCode(...bytes))}`;
}

export function fromDataUri(uri: string): Registration {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) throw new Error("agentURI is not a base64 JSON data URI");
  const bytes = Uint8Array.from(atob(uri.slice(prefix.length)), (c) => c.charCodeAt(0));
  return registrationSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

/** What `pnpm erc8004:fuji` wrote after registering the Guardian on Fuji. */
export const erc8004RecordSchema = z.object({
  network: z.literal("fuji"),
  identityRegistry: addressSchema,
  agentId: z.number().int().nonnegative(),
  owner: addressSchema,
  registerTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  uriTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  agentURI: z.string().min(1),
});
export type Erc8004Record = z.infer<typeof erc8004RecordSchema>;

/** The Fuji registration, or undefined before `pnpm erc8004:fuji` has run. */
export function getErc8004Record(): Erc8004Record | undefined {
  const parsed = erc8004RecordSchema.safeParse(record);
  return parsed.success ? parsed.data : undefined;
}
