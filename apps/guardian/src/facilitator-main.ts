// `pnpm --filter @guardian402/guardian facilitator`: a self-hosted x402 facilitator on http://127.0.0.1:4022.
// Settles on FACILITATOR_RPC_URL (default CHAIN_RPC_URL: the fork in local mode, Fuji in fuji mode).
// Then set FACILITATOR_URL=http://127.0.0.1:4022 for the Guardian.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFacilitatorApp } from "./facilitator.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));

const pk = process.env.FACILITATOR_PK ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error("Set FACILITATOR_PK in .env.local: a testnet key with a little AVAX for settlement gas.");
  process.exit(1);
}
const rpcUrl = process.env.FACILITATOR_RPC_URL || process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
const port = Number(process.env.FACILITATOR_PORT || 4022);
const { app, address } = createFacilitatorApp({
  rpcUrl,
  privateKey: pk as `0x${string}`,
  log: (l) => console.log(`[facilitator] ${l}`),
});
app.listen(port, "127.0.0.1", () => {
  console.log(`[facilitator] http://127.0.0.1:${port} · settles on ${rpcUrl} · gas paid by ${address}`);
});
