// One activity feed from three sources: the Guardian's checks, the vault's Executed events and the demo agent's
// attempts. Each item is a transaction's journey: what the agent proposed, what the Guardian found, and what the
// vault did. A Guardian verdict is never presented as an execution: only an Executed event (or the agent's own
// receipt) makes an item "executed". Pure functions; the React hooks live in activity-hooks.ts.
import type { Diff, RiskLevel } from "@guardian402/shared";
import type { ExecutedEvent } from "./events";
import { formatAmount, isUnlimited, shortHex } from "./format";
import type { Attempt, CheckListRow } from "./types";

export type Outcome =
  | { kind: "executed"; tx?: string | undefined }
  | { kind: "rejected"; reason: string | undefined; tx?: string | undefined }
  | { kind: "trial" }
  | { kind: "check-only" }
  | { kind: "not-seen" };

export type ActivityItem = {
  id: string;
  at: number;
  check?: CheckListRow;
  execution?: ExecutedEvent;
  attempt?: Attempt;
  risk?: RiskLevel;
  outcome: Outcome;
};

export type NameOf = (address: string) => string | undefined;
type Meta = (token: string) => { symbol: string; decimals: number };

const who = (address: string, nameOf: NameOf) => nameOf(address) ?? shortHex(address);
const ZERO_CHECK = /^0x0{64}$/i;

/** What the transaction does to the vault's money, as one sentence: the "Agent đề xuất" stop. */
export function summarizeDiff(diff: Diff, vault: string, nameOf: NameOf, meta: Meta): string {
  const v = vault.toLowerCase();
  const parts: string[] = [];
  for (const a of diff.approvals) {
    const m = meta(a.token);
    const amount =
      a.unlimited || isUnlimited(a.amount) ? "không giới hạn" : formatAmount(a.amount, m.decimals);
    parts.push(`Cấp quyền rút ${amount} ${m.symbol} cho ${who(a.spender, nameOf)}`);
  }
  const out = diff.tokenDeltas.filter((t) => BigInt(t.delta) < 0n);
  const inc = diff.tokenDeltas.filter((t) => BigInt(t.delta) > 0n);
  const [o, i] = [out[0], inc[0]];
  if (o && i) {
    parts.push(
      `Swap ${formatAmount(-BigInt(o.delta), o.decimals)} ${o.symbol} lấy ${formatAmount(i.delta, i.decimals)} ${i.symbol}`,
    );
  } else if (o) {
    const to = diff.transfers.find((t) => t.from.toLowerCase() === v)?.to;
    parts.push(
      `Chuyển ${formatAmount(-BigInt(o.delta), o.decimals)} ${o.symbol}${to ? ` tới ${who(to, nameOf)}` : ""}`,
    );
  }
  if (BigInt(diff.nativeDelta) < 0n) parts.push(`Gửi ${formatAmount(-BigInt(diff.nativeDelta), 18)} AVAX`);
  return parts.length ? parts.join(" · ") : "Không làm đổi số dư của két";
}

/** The money lines of a diff, signed, for the "ảnh hưởng tới tiền" row. */
export function moneyEffects(diff: Diff): { symbol: string; raw: bigint; decimals: number }[] {
  const lines = diff.tokenDeltas
    .filter((t) => BigInt(t.delta) !== 0n)
    .map((t) => ({ symbol: t.symbol, raw: BigInt(t.delta), decimals: t.decimals }));
  if (BigInt(diff.nativeDelta) !== 0n)
    lines.push({ symbol: "AVAX", raw: BigInt(diff.nativeDelta), decimals: 18 });
  return lines;
}

/**
 * What the vault did with an agent attempt. An attempt recorded on another network (a Fuji run seen from the
 * fork, or the reverse) keeps its outcome, but its transaction is not on this explorer, so no link.
 */
export function attemptOutcome(a: Attempt, network?: string): Outcome {
  const here = network === undefined || a.network === network;
  const rejected = a.vault.find((o) => o.status === "reverted");
  if (rejected) return { kind: "rejected", reason: rejected.revert, tx: here ? rejected.tx : undefined };
  const done = a.vault.find((o) => o.status === "success");
  if (done) return { kind: "executed", tx: here ? done.tx : undefined };
  return { kind: "not-seen" };
}

/** Joins the three sources into one list, newest first. */
export function buildActivity(input: {
  checks: CheckListRow[];
  executions: ExecutedEvent[];
  attempts: Attempt[];
  /** The dashboard's network: attempts made elsewhere only annotate their own checks. */
  network?: string;
}): ActivityItem[] {
  const execByCheck = new Map<string, ExecutedEvent>();
  for (const e of input.executions)
    if (e.withVerdict && !ZERO_CHECK.test(e.checkId)) execByCheck.set(e.checkId.toLowerCase(), e);
  const attemptByCheck = new Map<string, Attempt>();
  for (const a of input.attempts)
    if (a.guardian?.checkId) attemptByCheck.set(a.guardian.checkId.toLowerCase(), a);

  const used = new Set<string>();
  const items: ActivityItem[] = input.checks.map((c) => {
    const key = c.checkId.toLowerCase();
    const execution = execByCheck.get(key);
    const attempt = attemptByCheck.get(key);
    if (execution) used.add(execution.txHash.toLowerCase());
    if (attempt) used.add(`attempt:${attempt.at}`);
    const outcome: Outcome =
      c.endpoint === "demo"
        ? { kind: "trial" }
        : execution
          ? { kind: "executed", tx: execution.txHash }
          : attempt
            ? attemptOutcome(attempt, input.network)
            : c.endpoint === "check"
              ? { kind: "check-only" }
              : { kind: "not-seen" };
    return {
      id: c.checkId,
      at: c.createdAt,
      check: c,
      ...(execution ? { execution } : {}),
      ...(attempt ? { attempt } : {}),
      risk: c.risk,
      outcome,
    };
  });

  for (const e of input.executions) {
    if (used.has(e.txHash.toLowerCase())) continue;
    items.push({
      id: e.txHash,
      at: e.timeMs ?? 0,
      execution: e,
      outcome: { kind: "executed", tx: e.txHash },
    });
  }
  for (const a of input.attempts) {
    if (used.has(`attempt:${a.at}`)) continue;
    if (input.network !== undefined && a.network !== input.network) continue;
    if (!a.vault.some((o) => o.status !== "not-sent")) continue;
    items.push({
      id: `attempt:${a.at}:${a.scenario}`,
      at: Date.parse(a.at),
      attempt: a,
      ...(a.guardian?.risk ? { risk: a.guardian.risk } : {}),
      outcome: attemptOutcome(a, input.network),
    });
  }
  return items.sort((x, y) => y.at - x.at);
}

/** The Guardian check behind an item, from the check list or from the agent's own record of it. */
export const checkIdOf = (item: ActivityItem) => item.check?.checkId ?? item.attempt?.guardian?.checkId;

/** An agent attempt on its own (the "Chạy thật" result of the trial page). */
export const itemFromAttempt = (a: Attempt): ActivityItem => ({
  id: `attempt:${a.at}:${a.scenario}`,
  at: Date.parse(a.at),
  attempt: a,
  ...(a.guardian?.risk ? { risk: a.guardian.risk } : {}),
  outcome: attemptOutcome(a),
});

export type ActivityFilter = "all" | "high" | "rejected" | "executed";
export const FILTER_LABEL: Record<ActivityFilter, string> = {
  all: "Tất cả",
  high: "Rủi ro cao",
  rejected: "Két đã từ chối",
  executed: "Đã thực hiện",
};
export const matchesFilter = (item: ActivityItem, f: ActivityFilter) =>
  f === "all" ||
  (f === "high" && item.risk === "HIGH") ||
  (f === "rejected" && item.outcome.kind === "rejected") ||
  (f === "executed" && item.outcome.kind === "executed");

/** Needs the owner's attention: high risk that was not just a trial, or anything the vault rejected. */
export const needsAttention = (item: ActivityItem) =>
  item.outcome.kind === "rejected" || (item.risk === "HIGH" && item.outcome.kind !== "trial");
