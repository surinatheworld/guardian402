// Startup retry: the fork's first reset fetches Fuji state and can time out on a slow upstream or a fork that is
// still starting. The Guardian waits and tries again instead of exiting, so a supervisor never crash-loops it.

export type RetryOptions = {
  /** Total attempts, the first included. */
  attempts: number;
  /** Delay before the second attempt; doubles each time up to `maxDelayMs`. */
  delayMs: number;
  maxDelayMs: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let delay = opts.delayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= opts.attempts) throw error;
      opts.onRetry?.(error, attempt, delay);
      await sleep(delay);
      delay = Math.min(delay * 2, opts.maxDelayMs);
    }
  }
}
