// Risk = the highest severity among findings (LOW when there are none); score = min(100, Σ weights)
// with HIGH = 60 and MEDIUM = 25 by default (docs/SPEC.md §8). LOW findings weigh nothing.
import { RISK_CODE, type RiskCode, type RiskLevel } from "@guardian402/shared";
import { defaultRuleConfig } from "./config.ts";
import type { Finding, RuleConfig } from "./types.ts";

export type Aggregate = { risk: RiskLevel; riskCode: RiskCode; score: number };

export function aggregate(findings: readonly Finding[], cfg: RuleConfig = defaultRuleConfig): Aggregate {
  let riskCode: RiskCode = 0;
  let score = 0;
  for (const f of findings) {
    const code = RISK_CODE[f.severity];
    if (code > riskCode) riskCode = code;
    if (f.severity === "HIGH") score += cfg.weights.HIGH;
    else if (f.severity === "MEDIUM") score += cfg.weights.MEDIUM;
  }
  const risk: RiskLevel = riskCode === 2 ? "HIGH" : riskCode === 1 ? "MEDIUM" : "LOW";
  return { risk, riskCode, score: Math.min(100, score) };
}
