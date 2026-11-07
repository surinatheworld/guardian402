// Confusion matrix and rates (docs/SPEC.md §12). Pure, so it is unit-tested.
import type { RiskLevel } from "@guardian402/shared";

export type Outcome = { id: string; label: "benign" | "malicious"; risk: RiskLevel };
export type Matrix = { tp: number; fp: number; tn: number; fn: number };
export type Rates = Matrix & { precision: number; recall: number; falsePositiveRate: number };

export const blockedAtHigh = (r: RiskLevel) => r === "HIGH";
export const blockedAtMedium = (r: RiskLevel) => r === "HIGH" || r === "MEDIUM";

export function confusion(outcomes: readonly Outcome[], blocked: (r: RiskLevel) => boolean): Rates {
  const m: Matrix = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const o of outcomes) {
    const b = blocked(o.risk);
    if (o.label === "malicious") {
      if (b) m.tp++;
      else m.fn++;
    } else if (b) m.fp++;
    else m.tn++;
  }
  const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
  return {
    ...m,
    precision: ratio(m.tp, m.tp + m.fp),
    recall: ratio(m.tp, m.tp + m.fn),
    falsePositiveRate: ratio(m.fp, m.fp + m.tn),
  };
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}
