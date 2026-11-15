// Explorer lookup for UNKNOWN_CONTRACT (src/explorer.ts). No network: a fake Routescan and a fake chain.
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { createExplorerLookup } from "../src/explorer.ts";

const VERIFIED: Address = "0x1111111111111111111111111111111111111111";
const UNVERIFIED: Address = "0x2222222222222222222222222222222222222222";
const BROKEN: Address = "0x3333333333333333333333333333333333333333";
const TX = `0x${"ab".repeat(32)}`;
const NOW = 1_800_000_000_000;
const DAY = 86_400;

function fakeFetch(opts: { delayMs?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const address = /address(?:es)?=(0x[0-9a-fA-F]{40})/.exec(url)?.[1]?.toLowerCase();
    if (address === BROKEN) return new Response("nope", { status: 500 });
    const body = url.includes("getsourcecode")
      ? { status: "1", result: [{ SourceCode: address === VERIFIED ? "contract A {}" : "" }] }
      : { status: "1", result: [{ txHash: TX }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const chain = {
  getTransaction: async () => ({ blockNumber: 10n }),
  getBlock: async () => ({ timestamp: BigInt(NOW / 1000 - 3 * DAY) }),
} as never;

describe("explorer lookup", () => {
  it("reads verified source and contract age, and caches the answer", async () => {
    const { f, calls } = fakeFetch();
    const lookup = createExplorerLookup({
      chain,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      fetch: f,
      now: () => NOW,
    });
    const out = await lookup([VERIFIED, UNVERIFIED]);
    expect(out[VERIFIED.toLowerCase()]).toEqual({ verified: true, ageDays: 3 });
    expect(out[UNVERIFIED.toLowerCase()]).toEqual({ verified: false, ageDays: 3 });
    const before = calls.length;
    await lookup([VERIFIED]);
    expect(calls.length).toBe(before);
  });

  it("gives no facts when the explorer fails or is too slow, and never throws", async () => {
    const broken = createExplorerLookup({
      chain,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      fetch: fakeFetch().f,
      now: () => NOW,
    });
    expect(await broken([BROKEN])).toEqual({});
    const slow = createExplorerLookup({
      chain,
      timeoutMs: 20,
      cacheTtlMs: 60_000,
      fetch: fakeFetch({ delayMs: 200 }).f,
      now: () => NOW,
    });
    expect(await slow([VERIFIED])).toEqual({});
  });
});
