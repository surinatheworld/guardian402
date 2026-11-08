// Time budget of one simulation (P14). The 800 ms budget of SPEC §6.2 step 3 is the simulation's own run time:
// it starts when the run takes the fork, not when the request arrives, so a check that waits behind another
// one (or behind fork maintenance) is not failed for waiting. Waiting has its own cap.
//
// A run that times out keeps the fork until its snapshot is reverted, and meanwhile fills the fork's cache.
// The retry queues behind it and usually runs warm: this is what a cold fork needs after a start or a reset.
import type { Mutex } from "./mutex.ts";

export type Budget = {
  /** Budget of one run, from the moment it holds the fork. */
  timeoutMs: number;
  /** Cap on the whole call: waiting for the fork plus every attempt. */
  maxWaitMs: number;
  /** Extra attempts after a run times out (not after an error). */
  retries: number;
};

export type BudgetOutcome<T> =
  | { kind: "done"; value: T; attempts: number }
  | { kind: "timeout"; phase: "queue" | "run"; attempts: number }
  | { kind: "error"; error: unknown; attempts: number };

const wait = (ms: number) =>
  new Promise<"elapsed">((resolve) => setTimeout(() => resolve("elapsed"), Math.max(0, ms)).unref?.());

export async function runWithBudget<T>(
  mutex: Mutex,
  task: () => Promise<T>,
  budget: Budget,
): Promise<BudgetOutcome<T>> {
  const deadline = performance.now() + budget.maxWaitMs;
  for (let attempt = 1; ; attempt++) {
    let cancelled = false;
    let onLocked!: () => void;
    const locked = new Promise<"locked">((resolve) => (onLocked = () => resolve("locked")));
    const run = mutex.run(async () => {
      if (cancelled) throw new Error("cancelled before it started");
      onLocked();
      return task();
    });
    run.catch(() => undefined);

    // 1. Wait for the fork, at most until the deadline.
    const settled = run.then(
      () => "settled" as const,
      () => "settled" as const,
    );
    const first = await Promise.race([locked, settled, wait(deadline - performance.now())]);
    if (first === "elapsed") {
      cancelled = true; // still queued: it will not run
      return { kind: "timeout", phase: "queue", attempts: attempt };
    }

    // 2. The run holds the fork: its own budget starts now.
    const outcome = await Promise.race([
      run.then(
        (value) => ({ kind: "done" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      ),
      wait(budget.timeoutMs),
    ]);
    if (outcome !== "elapsed") return { ...outcome, attempts: attempt };
    if (attempt > budget.retries || performance.now() >= deadline) {
      return { kind: "timeout", phase: "run", attempts: attempt };
    }
  }
}
