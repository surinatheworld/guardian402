// `pnpm eval` (docs/SPEC.md §12): runs every case in eval/cases through the same pipeline as /v1/check (no
// payment, TemplateExplainer) on a fresh local fork, and writes eval/report.md and eval/report.json.
// Needs `pnpm fork` running and `cd contracts && forge build`. It resets the fork: stop any Guardian that is
// using the same fork first.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi } from "viem";
import { FUJI_CHAIN_ID, RULE_IDS, type RuleId } from "@guardian402/shared";
import { Pipeline } from "@guardian402/guardian/src/pipeline.ts";
import { TemplateExplainer } from "@guardian402/guardian/src/explain/template.ts";
import { createSigner } from "@guardian402/guardian/src/sign/index.ts";
import { Simulator } from "@guardian402/guardian/src/sim/index.ts";
import { defaultRuleConfig } from "@guardian402/guardian/src/rules/index.ts";
import type { KnownContract } from "@guardian402/guardian/src/rules/types.ts";
import { encodeCalls, loadCases, lookalike, placeholders, resolveSetup } from "./cases.ts";
import { applySetup, EVAL, ROOT, setUpFork } from "./fork.ts";
import { blockedAtHigh, blockedAtMedium, confusion, percentile } from "./metrics.ts";
import { writeReport, type CaseResult, type ReportData } from "./report.ts";

const FORK_RPC_URL = process.env.FORK_RPC_URL || "http://127.0.0.1:8545";
const FUJI_RPC_URL = process.env.FUJI_RPC_URL || undefined;
// Production uses 800 ms. The eval allows 10 s so latency to the public Fuji RPC (cold fork cache after each
// case reset) cannot turn into SIMULATION_FAILED and change a label between runs. Latency is still measured.
const SIM_TIMEOUT_MS = 10_000;

const cases = loadCases(join(ROOT, "eval/cases"));
console.log(`[eval] ${cases.length} cases · fork ${FORK_RPC_URL}`);
const fork = await setUpFork(FORK_RPC_URL, FUJI_RPC_URL);
const d = fork.deployment;
console.log(`[eval] fork block ${fork.forkBlock} · vault ${d.vault} · router ${d.router}`);

const knownContracts: Record<string, KnownContract> = {
  [d.vault.toLowerCase()]: { name: "AgentVault", kind: "vault" },
  [d.usdc.toLowerCase()]: { name: "USD Coin", kind: "token" },
  [d.mWAVAX.toLowerCase()]: { name: "Mock Wrapped AVAX (DEMO)", kind: "token" },
  [d.oracle.toLowerCase()]: { name: "MockOracle (DEMO)", kind: "oracle" },
  [d.router.toLowerCase()]: { name: "MockRouter (DEMO)", kind: "router" },
};
const simulator = new Simulator({
  forkRpcUrl: FORK_RPC_URL,
  timeoutMs: SIM_TIMEOUT_MS,
  knownTokens: [d.usdc, d.mWAVAX],
});
const pipeline = new Pipeline({
  chain: fork.client,
  simulator,
  explainer: new TemplateExplainer(),
  signer: createSigner(EVAL.guardian),
  deployment: d,
  knownContracts,
  ruleConfig: defaultRuleConfig,
  // Production thresholds (address poisoning 4/4), not the DEMO 3/3.
  demoMode: false,
  // Each case changes balances and approvals: never reuse a policy snapshot across cases.
  policyCacheMs: 0,
});

const p = placeholders({
  usdc: d.usdc,
  mWAVAX: d.mWAVAX,
  router: d.router,
  oracle: d.oracle,
  vault: d.vault,
  treasury: EVAL.treasury,
  attacker: EVAL.attacker,
  unknownRouter: fork.unknownRouter,
  unknownToken: fork.unknownToken,
  lookalikeRouter: lookalike(d.router),
  lookalikeTreasury: lookalike(EVAL.treasury),
  lookalikeVault: lookalike(d.vault),
});

// Warm the fork cache outside any snapshot (state fetched inside a snapshot is dropped when it is reverted).
for (const c of cases.slice(0, 3)) await simulator.simulate(d.vault, toCalls(encodeCalls(c, p)), [d.usdc]);

function toCalls(calls: ReturnType<typeof encodeCalls>) {
  return calls.map((c) => ({ ...c, value: BigInt(c.value) }));
}

const results: CaseResult[] = [];
let snapshot = (await fork.rpc("evm_snapshot")) as string;
for (const c of cases) {
  await fork.rpc("evm_revert", [snapshot]);
  snapshot = (await fork.rpc("evm_snapshot")) as string;
  await applySetup(fork, resolveSetup(c, p));
  const vaultUsdc = await fork.client.readContract({
    address: d.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [d.vault],
  });
  const calls = encodeCalls(c, { ...p, vaultUsdc: vaultUsdc.toString() });
  const req = pipeline.parse({ chainId: FUJI_CHAIN_ID, vault: d.vault, calls });
  const res = await pipeline.run(req, "check");
  const rules = RULE_IDS.filter((r) => res.findings.some((f) => f.ruleId === r));
  results.push({
    id: c.id,
    label: c.label,
    category: c.category,
    description: c.description,
    risk: res.risk,
    score: res.score,
    rules,
    expectedRules: c.expectedRules,
    missingRules: c.expectedRules.filter((r) => !rules.includes(r)),
    simulationSuccess: res.simulation.success,
    explanationVi: res.explanation.vi,
    latencyMs: res.latencyMs,
    ...(c.note ? { note: c.note } : {}),
  });
  const mark = (c.label === "malicious") === blockedAtHigh(res.risk) ? "ok " : "MIS";
  console.log(
    `[eval] ${mark} ${c.id.padEnd(34)} ${c.label.padEnd(9)} ${res.risk.padEnd(6)} ${rules.join(",")}`,
  );
}
await fork.rpc("evm_revert", [snapshot]);

const high = confusion(results, blockedAtHigh);
const medium = confusion(results, blockedAtMedium);
const latencies = results.map((r) => r.latencyMs);
const hitsPerRule = Object.fromEntries(
  RULE_IDS.map((r) => [
    r,
    {
      benign: results.filter((x) => x.label === "benign" && x.rules.includes(r)).length,
      malicious: results.filter((x) => x.label === "malicious" && x.rules.includes(r)).length,
    },
  ]),
) as Record<RuleId, { benign: number; malicious: number }>;
// Everything except latency: two runs must give the same fingerprint.
const fingerprint = createHash("sha256")
  .update(JSON.stringify(results.map((r) => [r.id, r.risk, r.score, r.rules])))
  .digest("hex")
  .slice(0, 16);

const report: ReportData = {
  cases: results.length,
  benign: results.filter((r) => r.label === "benign").length,
  malicious: results.filter((r) => r.label === "malicious").length,
  forkBlock: fork.forkBlock.toString(),
  blockedHigh: high,
  blockedMediumOrAbove: medium,
  hitsPerRule,
  latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  simulationTimeoutMs: SIM_TIMEOUT_MS,
  fingerprint,
  results,
};
writeFileSync(join(ROOT, "eval/report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(ROOT, "eval/report.md"), writeReport(report));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(
  `[eval] blocked = HIGH: TP ${high.tp} FP ${high.fp} TN ${high.tn} FN ${high.fn} · precision ${pct(high.precision)} · recall ${pct(high.recall)} · FPR ${pct(high.falsePositiveRate)}`,
);
console.log(
  `[eval] blocked ≥ MEDIUM: TP ${medium.tp} FP ${medium.fp} TN ${medium.tn} FN ${medium.fn} · precision ${pct(medium.precision)} · recall ${pct(medium.recall)} · FPR ${pct(medium.falsePositiveRate)}`,
);
console.log(
  `[eval] latency p50 ${report.latencyMs.p50} ms · p95 ${report.latencyMs.p95} ms · fingerprint ${fingerprint}`,
);
console.log("[eval] wrote eval/report.md and eval/report.json");
