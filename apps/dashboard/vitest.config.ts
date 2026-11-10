import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/…" alias as tsconfig, so route handlers can be imported in tests. Accounts tests run on an
// in-memory database (ACCOUNT_DB=":memory:").
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { env: { ACCOUNT_DB: ":memory:" } },
});
