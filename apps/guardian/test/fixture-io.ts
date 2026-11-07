// JSON with bigints, for rule fixtures: a bigint is stored as { "$bigint": "123" }.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SimResult } from "../src/sim/types.ts";
import type { Context } from "../src/rules/types.ts";

export const RULE_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/rules");

/** One captured simulation and the context it ran in, plus what it was built to show. */
export type RuleFixture = { name: string; description: string; sim: SimResult; ctx: Context };

export const toJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v), 2);

export const fromJson = <T>(text: string): T =>
  JSON.parse(text, (_k, v) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    typeof v.$bigint === "string"
      ? BigInt(v.$bigint)
      : v,
  ) as T;

export function loadRuleFixtures(): Record<string, RuleFixture> {
  const out: Record<string, RuleFixture> = {};
  for (const file of readdirSync(RULE_FIXTURES_DIR).filter((f) => f.endsWith(".json"))) {
    const f = fromJson<RuleFixture>(readFileSync(join(RULE_FIXTURES_DIR, file), "utf8"));
    out[f.name] = f;
  }
  return out;
}
