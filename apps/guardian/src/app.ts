// Guardian API routes (docs/SPEC.md §6.1).
import express, { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import type { x402ResourceServer } from "@x402/express";
import { paymentMiddleware } from "@x402/express";
import { RULE_IDS, type Deployment } from "@guardian402/shared";
import type { Address } from "viem";
import { InputError, type Endpoint, type Pipeline } from "./pipeline.ts";
import { RULE_SEVERITY } from "./rules/severity.ts";
import type { RuleConfig } from "./rules/types.ts";
import type { Store } from "./store.ts";
import { paidRoutes } from "./x402.ts";

export type AppDeps = {
  pipeline: Pipeline;
  store: Store;
  ruleConfig: RuleConfig;
  deployment: Deployment;
  signerAddress: Address;
  payTo: Address;
  demoMode: boolean;
  dashboardOrigin: string;
  /** null = no paywall (unit tests only). */
  resourceServer: x402ResourceServer | null;
  forkBlock: () => Promise<bigint>;
  log?: Logger;
  /** Sync with the facilitator on startup (the middleware default); off in unit tests. */
  syncFacilitatorOnStart?: boolean;
};

/** A tiny in-memory limiter for the free demo endpoint (no IPs are stored). */
function rateLimit(perMinute: number) {
  let windowStart = Date.now();
  let count = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (Date.now() - windowStart > 60_000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > perMinute) {
      res.status(429).json({ error: "rate limited" });
      return;
    }
    next();
  };
}

export function createApp(d: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // CORS for the dashboard origin only (free GET endpoints and the demo check).
  app.use((req, res, next) => {
    if (req.headers.origin === d.dashboardOrigin) {
      res.setHeader("Access-Control-Allow-Origin", d.dashboardOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  if (d.resourceServer) {
    app.use(
      paymentMiddleware(
        paidRoutes(d.payTo),
        d.resourceServer,
        undefined,
        undefined,
        d.syncFacilitatorOnStart ?? true,
      ),
    );
  }

  const handle = (endpoint: Endpoint) => async (req: Request, res: Response) => {
    try {
      const body = d.pipeline.parse(req.body);
      const out = await d.pipeline.run(body, endpoint);
      res.json(out);
    } catch (e) {
      if (e instanceof InputError) {
        res.status(400).json({ error: "invalid request", details: e.details });
        return;
      }
      d.log?.error({ err: (e as Error).message, endpoint }, "check failed");
      // ≥ 400: the x402 middleware does not settle, so the caller is not charged.
      res.status(502).json({ error: "check failed", details: (e as Error).message });
    }
  };

  app.post("/v1/check", handle("check"));
  app.post("/v1/cosign", handle("cosign"));
  if (d.demoMode) app.post("/v1/demo/check", rateLimit(30), handle("demo"));

  app.get("/v1/health", async (_req, res) => {
    const forkBlock = await d.forkBlock().catch(() => null);
    res.json({
      ok: forkBlock !== null,
      network: d.deployment.network,
      vault: d.deployment.vault,
      signer: d.signerAddress,
      payTo: d.payTo,
      forkBlock: forkBlock?.toString() ?? null,
      demoMode: d.demoMode,
    });
  });

  app.get("/v1/rules", (_req, res) => {
    const c = d.ruleConfig;
    res.json({
      rules: RULE_IDS.map((id) => ({ ruleId: id, severity: RULE_SEVERITY[id] })),
      thresholds: {
        unlimitedApproval: c.unlimitedApproval.threshold.toString(),
        addressPoisoning: d.demoMode
          ? { prefix: c.addressPoisoning.demoPrefix, suffix: c.addressPoisoning.demoSuffix }
          : { prefix: c.addressPoisoning.prefix, suffix: c.addressPoisoning.suffix },
        drainPercent: c.drainPattern.percent,
        slippageBps: c.abnormalSlippage,
        weights: c.weights,
      },
    });
  });

  app.get("/v1/stats", (_req, res) => res.json({ ...d.store.stats(), recentPayments: d.store.payments(20) }));

  app.get("/v1/checks", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ checks: d.store.recentChecks(limit) });
  });

  app.get("/v1/checks/:checkId", (req, res) => {
    const row = /^0x[0-9a-fA-F]{64}$/.test(req.params.checkId)
      ? d.store.getCheck(req.params.checkId)
      : undefined;
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });
  // Malformed or oversized JSON bodies: a JSON error, never an HTML page (and never settled: status ≥ 400).
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid request", details: "malformed JSON body" });
      return;
    }
    if (err.status === 413) {
      res.status(413).json({ error: "request too large" });
      return;
    }
    next(err);
  });
  return app;
}
