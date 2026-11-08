// Local control API for the dashboard's scenario buttons (docs/SPEC.md §10), DEMO only.
//
// P13 hardening (docs/THREAT_MODEL.md, finding F5): a scenario spends the agent's testnet USDC and sends
// transactions, so only the dashboard may start one.
// - Host must be this machine (127.0.0.1 / localhost on our port): blocks DNS rebinding, where a web page
//   points its own domain at 127.0.0.1 to read or call this API as same-origin.
// - POST needs the dashboard's Origin AND the X-Guardian402-Demo header. Browsers always send Origin on a
//   cross-origin POST and a page cannot fake it; the custom header forces a CORS preflight, which only the
//   dashboard origin passes. A page on any other site therefore cannot start a scenario.
import express, { type NextFunction, type Request, type Response } from "express";
import { SCENARIO_IDS, type ScenarioId } from "./scenarios.ts";

export const DEMO_HEADER = "x-guardian402-demo";

export type ControlDeps = {
  /** Exact dashboard origin, e.g. http://localhost:3000. */
  origin: string;
  /** The port this API listens on, for the Host check. */
  port: number;
  health: () => Record<string, unknown>;
  attempts: (limit: number) => unknown[];
  run: (id: ScenarioId) => Promise<unknown>;
};

export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function createControlApp(d: ControlDeps) {
  const hosts = allowedHosts(d.port);
  let busy = false;
  const app = express();
  app.disable("x-powered-by");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) {
      res.status(403).json({ error: "forbidden host" });
      return;
    }
    if (req.headers.origin === d.origin) {
      res.setHeader("Access-Control-Allow-Origin", d.origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", DEMO_HEADER);
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ...d.health(), busy });
  });
  app.get("/attempts", (req, res) => {
    res.json({ attempts: d.attempts(Math.min(200, Number(req.query.limit) || 50)) });
  });
  app.post("/scenario/:id", async (req, res) => {
    if (req.headers.origin !== d.origin || req.headers[DEMO_HEADER] !== "1") {
      res.status(403).json({ error: "scenarios start only from the dashboard" });
      return;
    }
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
      res.json(await d.run(id));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    } finally {
      busy = false;
    }
  });
  return app;
}
