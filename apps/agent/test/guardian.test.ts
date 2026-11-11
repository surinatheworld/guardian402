// The Guardian answers 503 when it is busy or could not simulate the batch (docs/SPEC.md §6.2). Nothing is
// settled then, so the agent asks again after Retry-After, a bounded number of times.
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { askGuardian, retryAfterMs, UNAVAILABLE_RETRIES, type PayingFetch } from "../src/guardian.ts";

const VAULT = "0x3f6a5852788ff6a46d924C407976bB89487f7651" as Address;
const CALLS = [
  { target: "0x5425890298aed601595a70AB815c96711a31Bc65" as Address, value: 0n, data: "0x" as Hex },
];

const CHECK = {
  checkId: `0x${"11".repeat(32)}`,
  risk: "LOW",
  riskCode: 0,
  score: 0,
  findings: [],
  simulation: { success: true, gasUsed: "21000", forkBlock: "1" },
  diff: { tokenDeltas: [], nativeDelta: "0", approvals: [], transfers: [] },
  explanation: { vi: "Rủi ro THẤP.", en: "LOW risk.", source: "template" },
  latencyMs: 10,
  demoMode: false,
};

const unavailable = (retryAfter?: string) =>
  new Response(JSON.stringify({ error: "simulation unavailable, try again in a few seconds" }), {
    status: 503,
    headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
  });
const ok = () => new Response(JSON.stringify(CHECK), { status: 200 });

function fakeFetch(responses: (() => Response)[]) {
  const bodies: string[] = [];
  const f: PayingFetch = async (_url, init) => {
    bodies.push(String(init.body));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  };
  return { f, bodies };
}

describe("askGuardian", () => {
  it("asks again after a 503, waiting Retry-After, and returns the check", async () => {
    const { f, bodies } = fakeFetch([() => unavailable("5"), ok]);
    const waits: number[] = [];
    const r = await askGuardian(f, "http://guardian", "check", VAULT, CALLS, {
      sleep: async (ms) => void waits.push(ms),
    });
    expect(r.status).toBe(200);
    expect(r.response?.risk).toBe("LOW");
    expect(waits).toEqual([5000]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]); // the same batch both times
  });

  it("gives up after a bounded number of retries", async () => {
    const { f, bodies } = fakeFetch(Array.from({ length: 10 }, () => () => unavailable("1")));
    const r = await askGuardian(f, "http://guardian", "cosign", VAULT, CALLS, { sleep: async () => {} });
    expect(r.status).toBe(503);
    expect(r.response).toBeUndefined();
    expect(bodies).toHaveLength(UNAVAILABLE_RETRIES + 1);
  });

  it("does not retry other errors (a 400 is the caller's mistake)", async () => {
    const { f, bodies } = fakeFetch([
      () => new Response(JSON.stringify({ error: "invalid request" }), { status: 400 }),
    ]);
    const r = await askGuardian(f, "http://guardian", "check", VAULT, CALLS, { sleep: async () => {} });
    expect(r.status).toBe(400);
    expect(bodies).toHaveLength(1);
  });

  it("reads Retry-After in seconds, capped, with a default", () => {
    expect(retryAfterMs("5")).toBe(5000);
    expect(retryAfterMs(" 2 ")).toBe(2000);
    expect(retryAfterMs("3600")).toBe(10_000);
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(5000);
    expect(retryAfterMs("-1")).toBe(5000);
  });
});
