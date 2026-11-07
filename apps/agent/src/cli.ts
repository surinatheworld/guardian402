// `pnpm agent scenario <S1..S6|all>`: runs scenarios and prints the Guardian result, the x402 settlement link
// and the vault transaction (docs/SPEC.md §10). Exits 1 if any result differs from the spec table.
import { loadEnv } from "./env.ts";
import { createRunner, SCENARIO_IDS, type ScenarioId } from "./scenarios.ts";

const [cmd, arg] = process.argv.slice(2);
if (cmd !== "scenario" || !arg) {
  console.error("usage: pnpm agent scenario <S1|S2|S3|S4|S5|S6|all>");
  process.exit(2);
}
const ids: ScenarioId[] = arg.toLowerCase() === "all" ? [...SCENARIO_IDS] : [arg.toUpperCase() as ScenarioId];
if (!ids.every((id) => (SCENARIO_IDS as readonly string[]).includes(id))) {
  console.error(`unknown scenario "${arg}"`);
  process.exit(2);
}
const env = loadEnv();
if (ids.some((id) => id !== "S1") && !env.DEMO_MODE) {
  console.error("S2–S6 are DEMO scenarios (scripted attacks): set DEMO_MODE=true.");
  process.exit(2);
}
const runner = createRunner(env);
let failed = 0;
for (const id of ids) {
  const a = await runner.run(id);
  if (!a.matched) failed++;
}
process.exit(failed ? 1 : 0);
