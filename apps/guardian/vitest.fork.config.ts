import { defineConfig } from "vitest/config";

// Integration tests against a running Anvil fork of Fuji (`pnpm fork`). They share one chain, so run serially.
export default defineConfig({
  test: {
    include: ["test/**/*.fork.test.ts"],
    fileParallelism: false,
    silent: false, // keep the latency log of passing tests

    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
