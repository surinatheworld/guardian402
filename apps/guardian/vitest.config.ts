import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only. Fork integration tests (*.fork.test.ts) need `pnpm fork` and run with `pnpm test:fork`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/*.fork.test.ts"] },
});
