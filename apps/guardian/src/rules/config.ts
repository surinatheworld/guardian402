// Rule thresholds live in apps/guardian/config/rules.json (docs/SPEC.md §8).
import { z } from "zod";
import rulesJson from "../../config/rules.json" with { type: "json" };
import type { RuleConfig } from "./types.ts";

const ruleConfigSchema = z
  .object({
    weights: z.object({ HIGH: z.number().int().positive(), MEDIUM: z.number().int().positive() }),
    unlimitedApproval: z.object({ threshold: z.string().regex(/^[1-9][0-9]*$/) }),
    addressPoisoning: z.object({
      prefix: z.number().int().min(1).max(20),
      suffix: z.number().int().min(1).max(20),
      demoPrefix: z.number().int().min(1).max(20),
      demoSuffix: z.number().int().min(1).max(20),
      maxDiff: z.number().int().min(0).max(39),
    }),
    drainPattern: z.object({ percent: z.number().int().min(1).max(100) }),
    abnormalSlippage: z
      .object({ mediumBps: z.number().int().positive(), highBps: z.number().int().positive() })
      .refine((s) => s.mediumBps < s.highBps, "mediumBps must be below highBps"),
    unprotectedSwap: z.object({ maxGapBps: z.number().int().min(0).max(10_000) }),
    explorerLookup: z.object({
      enabled: z.boolean(),
      timeoutMs: z.number().int().positive(),
      cacheTtlMs: z.number().int().nonnegative(),
      newContractDays: z.number().int().nonnegative(),
    }),
  })
  .strict();

export function parseRuleConfig(raw: unknown): RuleConfig {
  const c = ruleConfigSchema.parse(raw);
  return { ...c, unlimitedApproval: { threshold: BigInt(c.unlimitedApproval.threshold) } };
}

/** The committed defaults. */
export const defaultRuleConfig: RuleConfig = parseRuleConfig(rulesJson);
