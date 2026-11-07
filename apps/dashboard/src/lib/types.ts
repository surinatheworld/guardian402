// Response shapes of the Guardian API (apps/guardian/src/app.ts) and the agent control API
// (apps/agent/src/server.ts) as the dashboard reads them.
import type { RiskLevel } from "@guardian402/shared";

export type GuardianHealth = {
  ok: boolean;
  network: string;
  vault: string;
  signer: string;
  payTo: string;
  forkBlock: string | null;
  demoMode: boolean;
};

export type CheckListRow = {
  checkId: string;
  createdAt: number;
  endpoint: string;
  vault: string;
  risk: RiskLevel;
  score: number;
  latencyMs: number;
  demo: boolean;
  ruleIds: string[];
  explanation: { vi: string; en: string; source: string } | null;
  paymentTx: string | null;
};

export type Payment = {
  createdAt: number;
  payer: string | null;
  amount: string;
  txHash: string;
  endpoint: string;
  checkId: string | null;
};

export type Stats = {
  checks: Record<RiskLevel, number>;
  payments: { count: number; totalAtomic: string };
  latencyMs: { p50: number; p95: number };
  recentPayments: Payment[];
};

export type VaultOutcome = {
  tx?: string;
  status: "success" | "reverted" | "not-sent";
  revert?: string;
  revertArgs?: string;
};

export type Attempt = {
  at: string;
  scenario: string;
  name: string;
  network: string;
  mode: "safe" | "scripted-attack";
  guardian?: {
    endpoint: string;
    status: number;
    risk?: RiskLevel;
    findings?: string[];
    checkId?: string;
    paymentTx?: string;
    explanationVi?: string;
  };
  vault: VaultOutcome[];
  matched: boolean;
  mismatch?: string;
};

export type AgentHealth = { ok: boolean; demoMode: boolean; network: string; agent: string; busy: boolean };
