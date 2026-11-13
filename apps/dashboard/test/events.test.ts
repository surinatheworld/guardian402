import { describe, expect, it } from "vitest";
import { fetchExecutedFromRoutescan } from "../src/lib/events";

const VAULT = "0xff0db552A0Ffe0464273DAe402dd19efB7Bc9C2d";

function fakeFetch(seen: URL[]): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    seen.push(new URL(String(input)));
    return new Response(JSON.stringify({ status: "0", message: "No records found", result: [] }));
  }) as typeof fetch;
}

describe("fetchExecutedFromRoutescan", () => {
  // Routescan caches `toBlock=latest` per URL and kept answering without a payment made an hour earlier.
  it("asks up to the chain head when it is known", async () => {
    const seen: URL[] = [];
    await fetchExecutedFromRoutescan(fakeFetch(seen), VAULT, 60_973_955n);
    expect(seen[0]?.searchParams.get("toBlock")).toBe("60973955");
    expect(seen[0]?.searchParams.get("address")).toBe(VAULT);
  });

  it("falls back to latest without a head", async () => {
    const seen: URL[] = [];
    expect(await fetchExecutedFromRoutescan(fakeFetch(seen), VAULT)).toEqual([]);
    expect(seen[0]?.searchParams.get("toBlock")).toBe("latest");
  });
});
