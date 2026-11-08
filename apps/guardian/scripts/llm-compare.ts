// `pnpm --filter @guardian402/guardian llm:compare <provider:model>... [--gap ms] [--verbose]`
// Runs the 14 rule fixtures through each LLM explainer and prints how often the LLM's text was used, latency and
// why it fell back. Keys come from `.env.local`: <PROVIDER>_API_KEY (GROQ_API_KEY, OPENROUTER_API_KEY,
// CEREBRAS_API_KEY, MISTRAL_API_KEY, GITHUB_MODELS_API_KEY, GEMINI_API_KEY…), or LLM_API_KEY for the provider
// named in LLM_PROVIDER. Keys are never printed. `--gap` waits between calls (free tiers limit requests/minute).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createExplainer } from "../src/explain/index.ts";
import { explainInput } from "../src/explain-input.ts";
import { aggregate, runRules } from "../src/rules/index.ts";
import { loadRuleFixtures } from "../test/fixture-io.ts";

const ROOT = join(import.meta.dirname, "../../..");
for (const f of [join(ROOT, ".env.local"), join(ROOT, "apps/guardian/.env.local")])
  if (existsSync(f)) process.loadEnvFile(f);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args.splice(i, 2)[1] ?? "");
};
const gapMs = Number(flag("--gap") ?? 0);
const verbose = args.includes("--verbose");
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) {
  console.error(
    "usage: llm:compare <provider:model>... [--gap ms] [--verbose]   e.g. groq:llama-3.3-70b-versatile",
  );
  process.exit(2);
}

const envName = (provider: string) => `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
/** <PROVIDER>_API_KEY, else LLM_API_KEY when LLM_PROVIDER names the same service (gemini ↔ gemini-openai). */
function keyFor(provider: string): string | undefined {
  const own = process.env[envName(provider)];
  if (own) return own;
  const service = (p: string) => (p === "gemini-openai" ? "gemini" : p);
  if (service(process.env.LLM_PROVIDER?.toLowerCase() ?? "") === service(provider))
    return process.env.LLM_API_KEY;
  if (service(provider) === "gemini") return process.env.GEMINI_API_KEY;
  return undefined;
}

const F = loadRuleFixtures();
const names = Object.keys(F);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const summary: string[] = [];

for (const target of targets) {
  const [provider = "", ...rest] = target.split(":");
  const model = rest.join(":");
  const key = keyFor(provider);
  if (!key) {
    summary.push(`${target.padEnd(52)} skipped: no ${envName(provider)} in .env.local`);
    continue;
  }
  const reasons: string[] = [];
  let explainer;
  try {
    explainer = createExplainer({
      LLM_PROVIDER: provider,
      LLM_API_KEY: key,
      ...(model ? { LLM_MODEL: model } : {}),
      onFallback: (r) => reasons.push(r),
    });
  } catch (e) {
    summary.push(`${target.padEnd(52)} skipped: ${(e as Error).message}`);
    continue;
  }
  const times: number[] = [];
  const fallbacks = new Map<string, number>();
  let llm = 0;
  for (const name of names) {
    const f = F[name];
    if (!f) continue;
    const findings = runRules(f.sim, f.ctx);
    const risk = aggregate(findings).risk;
    const t = performance.now();
    const e = await explainer.explain(explainInput(f.sim, findings, risk, f.ctx));
    const ms = Math.round(performance.now() - t);
    const why = reasons.splice(0).join(",") || "?";
    if (e.source === "llm") {
      llm++;
      times.push(ms);
    } else fallbacks.set(why, (fallbacks.get(why) ?? 0) + 1);
    if (verbose)
      console.log(`[${target}] ${name} ${risk} ${e.source} ${ms} ms\n  vi: ${e.vi}\n  en: ${e.en}`);
    if (gapMs) await sleep(gapMs);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)] ?? 0;
  const fb = [...fallbacks].map(([k, v]) => `${k}×${v}`).join(" ");
  summary.push(
    `${target.padEnd(52)} llm ${String(llm).padStart(2)}/${names.length}  p50 ${String(p50).padStart(4)} ms  max ${String(times.at(-1) ?? 0).padStart(4)} ms${fb ? `  fallback: ${fb}` : ""}`,
  );
}
console.log(`\n${summary.join("\n")}`);
