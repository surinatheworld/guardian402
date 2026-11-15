// Environment of the Guardian API (docs/SPEC.md §3). Secrets come from .env.local and are never logged.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { DEFAULT_FACILITATOR_URL, FUJI_RPC_URL, NETWORKS } from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const schema = z.object({
  NETWORK: z.enum(NETWORKS).default("local"),
  FUJI_RPC_URL: z.url().default(FUJI_RPC_URL),
  CHAIN_RPC_URL: z.url().default("http://127.0.0.1:8545"),
  FORK_RPC_URL: z.url().default("http://127.0.0.1:8545"),
  GUARDIAN_SIGNER_PK: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "GUARDIAN_SIGNER_PK must be a 0x-prefixed 32-byte hex key"),
  PAY_TO: z.string().refine((v) => isAddress(v), "PAY_TO must be an address"),
  FACILITATOR_URL: z.url().default(DEFAULT_FACILITATOR_URL),
  LLM_PROVIDER: z.string().default("none"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.url().optional(),
  DEMO_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Optional Routescan lookup for UNKNOWN_CONTRACT (verified source, contract age); off by default.
  EXPLORER_LOOKUP: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Public base URL of the Guardian API (e.g. https://host/api/guardian): the x402 resource URL behind a proxy.
  GUARDIAN_PUBLIC_URL: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  GUARDIAN_PORT: z.coerce.number().int().positive().default(4402),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
  // Accepted Host headers, comma-separated host:port; empty = this machine on GUARDIAN_PORT (P13).
  ALLOWED_HOSTS: z.string().default(""),
  // Checks allowed to wait for the fork before new ones get 503 (P13).
  MAX_QUEUED_CHECKS: z.coerce.number().int().positive().default(8),
  // Relative paths are from the repo root, whatever directory the app starts in.
  GUARDIAN_DB: z
    .string()
    .default("apps/guardian/data/guardian.db")
    .transform((v) => (v === ":memory:" || isAbsolute(v) ? v : join(ROOT, v))),
});

export type Env = Omit<z.infer<typeof schema>, "GUARDIAN_SIGNER_PK" | "PAY_TO"> & {
  GUARDIAN_SIGNER_PK: Hex;
  PAY_TO: Address;
};

/** Reads `.env.local` at the repo root and apps/guardian (if present), then validates. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  for (const file of [join(ROOT, ".env.local"), join(ROOT, "apps/guardian/.env.local")]) {
    if (source === process.env && existsSync(file)) process.loadEnvFile(file);
  }
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${fields}`);
  }
  return parsed.data as Env;
}
