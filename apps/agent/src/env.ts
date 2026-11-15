import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { z } from "zod";
import { NETWORKS } from "@guardian402/shared";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const AGENT_DIR = join(ROOT, "apps/agent");

const key = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key");
const schema = z.object({
  NETWORK: z.enum(NETWORKS).default("local"),
  CHAIN_RPC_URL: z.url().default("http://127.0.0.1:8545"),
  GUARDIAN_URL: z.url().default("http://127.0.0.1:4402"),
  AGENT_PK: key,
  OWNER_PK: key.optional(),
  DEMO_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  AGENT_PORT: z.coerce.number().int().positive().default(4403),
});

export type AgentEnv = Omit<z.infer<typeof schema>, "AGENT_PK" | "OWNER_PK"> & {
  AGENT_PK: Hex;
  OWNER_PK?: Hex;
};

export function loadEnv(): AgentEnv {
  for (const f of [join(ROOT, ".env.local"), join(AGENT_DIR, ".env.local")])
    if (existsSync(f)) process.loadEnvFile(f);
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    throw new Error(
      `invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data as AgentEnv;
}
