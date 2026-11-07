// `pnpm dev:agent`: local control API for the dashboard's scenario buttons (docs/SPEC.md §10). Bound to
// 127.0.0.1 and only with DEMO_MODE=true. POST /scenario/:id runs one scenario; GET /attempts lists results.
import express from "express";
import { loadEnv } from "./env.ts";
import { createRunner, readAttempts, SCENARIO_IDS, type ScenarioId } from "./scenarios.ts";

const env = loadEnv();
if (!env.DEMO_MODE) {
  console.error("The agent control API runs only with DEMO_MODE=true.");
  process.exit(1);
}
const runner = createRunner(env);
const origin = process.env.DASHBOARD_ORIGIN || "http://localhost:3000";
let busy = false;

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (req.headers.origin === origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, demoMode: true, network: env.NETWORK, agent: runner.agent, busy });
});
app.get("/attempts", (req, res) => {
  res.json({ attempts: readAttempts(Math.min(200, Number(req.query.limit) || 50)) });
});
app.post("/scenario/:id", async (req, res) => {
  const id = req.params.id.toUpperCase() as ScenarioId;
  if (!(SCENARIO_IDS as readonly string[]).includes(id)) {
    res.status(404).json({ error: "unknown scenario" });
    return;
  }
  if (busy) {
    res.status(409).json({ error: "another scenario is running" });
    return;
  }
  busy = true;
  try {
    res.json(await runner.run(id));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  } finally {
    busy = false;
  }
});

app.listen(env.AGENT_PORT, "127.0.0.1", () => {
  console.log(
    `[agent] control API http://127.0.0.1:${env.AGENT_PORT} (DEMO) · agent ${runner.agent} · ${env.NETWORK}`,
  );
});
