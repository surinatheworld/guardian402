// `pnpm dev:agent`: local control API for the dashboard's scenario buttons (docs/SPEC.md §10). Bound to
// 127.0.0.1 and only with DEMO_MODE=true. POST /scenario/:id runs one scenario; GET /attempts lists results.
// Who may call it: src/control.ts.
import { createControlApp } from "./control.ts";
import { loadEnv } from "./env.ts";
import { createRunner, readAttempts } from "./scenarios.ts";

const env = loadEnv();
if (!env.DEMO_MODE) {
  console.error("The agent control API runs only with DEMO_MODE=true.");
  process.exit(1);
}
const runner = createRunner(env);
const app = createControlApp({
  origin: process.env.DASHBOARD_ORIGIN || "http://localhost:3000",
  port: env.AGENT_PORT,
  health: () => ({ ok: true, demoMode: true, network: env.NETWORK, agent: runner.agent }),
  attempts: readAttempts,
  run: (id) => runner.run(id),
});

app.listen(env.AGENT_PORT, "127.0.0.1", () => {
  console.log(
    `[agent] control API http://127.0.0.1:${env.AGENT_PORT} (DEMO) · agent ${runner.agent} · ${env.NETWORK}`,
  );
});
