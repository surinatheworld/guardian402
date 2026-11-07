#!/usr/bin/env node
// `pnpm known-contracts`: writes apps/guardian/config/known-contracts.<network>.json from the deployed addresses
// in packages/shared/src/addresses/<network>.json, plus the fixed Fuji contracts (USDC, ERC-8004 registries).
// Run it after `pnpm deploy:<network>`. Keys are lowercase addresses (docs/SPEC.md §8).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Fixed addresses on Fuji (docs/SPEC.md §2). A local fork inherits them.
const FIXED = {
  "0x8004A818BFB912233c491871b3d84c89A494BD9e": { name: "ERC-8004 IdentityRegistry", kind: "registry" },
  "0x8004B663056A597Dffe9eCcC1965A193B7388713": { name: "ERC-8004 ReputationRegistry", kind: "registry" },
};

for (const network of ["fuji", "local"]) {
  const a = JSON.parse(readFileSync(join(ROOT, `packages/shared/src/addresses/${network}.json`), "utf8"));
  const entries = {
    [a.usdc]: { name: "USD Coin", kind: "token" },
    [a.mWAVAX]: { name: "Mock Wrapped AVAX (DEMO)", kind: "token" },
    [a.oracle]: { name: "MockOracle (DEMO)", kind: "oracle" },
    [a.router]: { name: "MockRouter (DEMO)", kind: "router" },
    [a.vault]: { name: "AgentVault", kind: "vault" },
    ...FIXED,
  };
  const out = Object.fromEntries(
    Object.entries(entries)
      .map(([addr, v]) => [addr.toLowerCase(), v])
      .sort(([x], [y]) => x.localeCompare(y)),
  );
  const file = join(ROOT, `apps/guardian/config/known-contracts.${network}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[known-contracts] ${Object.keys(out).length} entries → ${file}`);
}
