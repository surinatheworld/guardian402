// P14: the simulation budget counts from the moment a run holds the fork, and one retry follows a timeout.
import { describe, expect, it } from "vitest";
import { runWithBudget } from "../src/sim/budget.ts";
import { Mutex } from "../src/sim/mutex.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const budget = { timeoutMs: 100, maxWaitMs: 2_000, retries: 1 };

describe("runWithBudget", () => {
  it("does not fail a check for waiting behind another run", async () => {
    const m = new Mutex();
    void m.run(() => sleep(300)); // e.g. fork maintenance or another check, longer than the run budget
    const out = await runWithBudget(m, async () => (await sleep(20), "ok"), budget);
    expect(out).toEqual({ kind: "done", value: "ok", attempts: 1 });
  });

  it("retries once after a timeout; the retry runs once the slow run is over", async () => {
    const m = new Mutex();
    let calls = 0;
    const out = await runWithBudget(
      m,
      async () => {
        calls++;
        await sleep(calls === 1 ? 250 : 10); // cold fork first, warm on the retry
        return calls;
      },
      budget,
    );
    expect(out).toEqual({ kind: "done", value: 2, attempts: 2 });
  });

  it("gives up after the retries", async () => {
    const m = new Mutex();
    const out = await runWithBudget(m, () => sleep(250), budget);
    expect(out).toMatchObject({ kind: "timeout", phase: "run", attempts: 2 });
  });

  it("caps the wait for the fork, and the queued run never starts", async () => {
    const m = new Mutex();
    void m.run(() => sleep(400));
    let started = false;
    const out = await runWithBudget(
      m,
      async () => {
        started = true;
      },
      { timeoutMs: 100, maxWaitMs: 150, retries: 1 },
    );
    expect(out).toMatchObject({ kind: "timeout", phase: "queue" });
    await sleep(350);
    expect(started).toBe(false);
  });

  it("does not retry an error", async () => {
    const m = new Mutex();
    let calls = 0;
    const out = await runWithBudget(
      m,
      async () => {
        calls++;
        throw new Error("rpc down");
      },
      budget,
    );
    expect(out).toMatchObject({ kind: "error", attempts: 1 });
    expect(calls).toBe(1);
  });
});
