import { describe, expect, it } from "vitest";
import { withRetry } from "../src/retry.ts";

describe("withRetry (startup fork check)", () => {
  it("retries with doubling, capped delays until the call succeeds", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 4) throw new Error("anvil_reset timed out");
        return "ok";
      },
      { attempts: 10, delayMs: 2_000, maxDelayMs: 5_000, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(4);
    expect(delays).toEqual([2_000, 4_000, 5_000]);
  });

  it("throws the last error once the attempts run out", async () => {
    const retried: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        {
          attempts: 3,
          delayMs: 1,
          maxDelayMs: 1,
          sleep: async () => {},
          onRetry: (_e, a) => retried.push(a),
        },
      ),
    ).rejects.toThrow("fail 3");
    expect(retried).toEqual([1, 2]);
  });
});
