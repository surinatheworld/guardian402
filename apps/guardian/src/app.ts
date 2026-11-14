// Guardian API routes (docs/SPEC.md §6.1).
import { createHash, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import type { x402ResourceServer } from "@x402/express";
import { paymentMiddleware } from "@x402/express";
import { RULE_IDS, type Deployment } from "@guardian402/shared";
import { isAddress, type Address } from "viem";
import { InputError, UnavailableError, type Endpoint, type Pipeline } from "./pipeline.ts";
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
  /**
   * P13 (docs/THREAT_MODEL.md, F6): true while too many checks wait for the fork. New checks then get 503
   * before any payment is taken, so a caller who pays for many checks cannot make everyone else time out.
   */
  busy?: () => boolean;
  /**
   * P13: accepted Host headers (host:port, lower case). Blocks DNS rebinding of the local API; a public
   * deployment behind a proxy lists its own host name. Undefined = no check (unit tests).
   */
  allowedHosts?: ReadonlySet<string>;
  /** null = no paywall (unit tests only). */
  resourceServer: x402ResourceServer | null;
  forkBlock: () => Promise<bigint>;
  log?: Logger;
  /** Limits of the free demo endpoint; default DEFAULT_DEMO_LIMIT. */
  demoLimit?: DemoLimit;
  /** Sync with the facilitator on startup (the middleware default); off in unit tests. */
  syncFacilitatorOnStart?: boolean;
};

/** Calls per minute to the free demo endpoint: for one caller, and for all callers together. */
export type DemoLimit = { perClient: number; overall: number };
export const DEFAULT_DEMO_LIMIT: DemoLimit = { perClient: 30, overall: 120 };
const LIMIT_WINDOW_MS = 60_000;
const MAX_LIMIT_KEYS = 5_000;

/**
 * The caller as the nearest proxy saw it: the last X-Forwarded-For entry (the dashboard's /api/guardian proxy
 * and a public tunnel pass it on), else the socket address. Someone who reaches the API directly can make the
 * header up, which is why the limiter also has a cap for everyone together.
 */
function callerOf(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const last = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .at(-1);
  return last ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * In-memory limiter for the free demo endpoint. One visitor can no longer use up the trial page for everyone
 * (it was one shared counter): each caller has its own minute window, and all callers together a larger one.
 * No address is kept: the key is a salted hash that lives in this process only.
 */
export function demoRateLimit(limit: DemoLimit, now: () => number = Date.now) {
  const salt = randomBytes(16);
  const callers = new Map<string, { start: number; count: number }>();
  let all = { start: now(), count: 0 };
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    if (t - all.start >= LIMIT_WINDOW_MS) all = { start: t, count: 0 };
    const key = createHash("sha256").update(salt).update(callerOf(req)).digest("base64url").slice(0, 22);
    let mine = callers.get(key);
    if (!mine || t - mine.start >= LIMIT_WINDOW_MS) {
      mine = { start: t, count: 0 };
      callers.set(key, mine);
      if (callers.size > MAX_LIMIT_KEYS)
        for (const [k, v] of callers) if (t - v.start >= LIMIT_WINDOW_MS) callers.delete(k);
    }
    // A caller over its own limit does not use up the shared one.
    if (mine.count >= limit.perClient || all.count >= limit.overall) {
      res.setHeader("Retry-After", String(Math.ceil((LIMIT_WINDOW_MS - (t - mine.start)) / 1000)));
      res.status(429).json({ error: "rate limited" });
      return;
    }
    mine.count++;
    all.count++;
    next();
  };
}

export function createApp(d: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  if (d.allowedHosts) {
    const hosts = d.allowedHosts;
    app.use((req, res, next) => {
      if (!hosts.has((req.headers.host ?? "").toLowerCase())) {
        res.status(403).json({ error: "forbidden host" });
        return;
      }
      next();
    });
  }

  // @x402/fetch 2.28.0 (dist/esm/index.mjs) sends PAYMENT-SIGNATURE (or the v1 X-PAYMENT) on the paid retry and,
  // oddly, an Access-Control-Expose-Headers request header; it reads PAYMENT-REQUIRED and PAYMENT-RESPONSE back.
  const X402_REQUEST_HEADERS = "content-type, payment-signature, x-payment, access-control-expose-headers";
  const X402_RESPONSE_HEADERS = "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Retry-After";
  // CORS for the dashboard origin only (free GET endpoints, the demo check, and the paid check/cosign the
  // dashboard's "try the agent on the web" pays over x402 from the browser: it sends PAYMENT-SIGNATURE and reads
  // PAYMENT-REQUIRED / PAYMENT-RESPONSE). `DASHBOARD_ORIGIN=*` opens it to any origin, for a public hackathon
  // demo: the API uses no cookies, so nothing ambient can be abused.
  app.use((req, res, next) => {
    const anyOrigin = d.dashboardOrigin === "*";
    if (anyOrigin || req.headers.origin === d.dashboardOrigin) {
      res.setHeader("Access-Control-Allow-Origin", anyOrigin ? "*" : d.dashboardOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", anyOrigin ? "*" : X402_REQUEST_HEADERS);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", anyOrigin ? "*" : X402_RESPONSE_HEADERS);
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Before the paywall: a busy Guardian answers 503 and nobody is charged.
  if (d.busy) {
    const busy = d.busy;
    app.use(["/v1/check", "/v1/cosign", "/v1/demo/check"], (req, res, next) => {
      if (req.method === "POST" && busy()) {
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "busy, try again in a few seconds" });
        return;
      }
      next();
    });
  }

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
      if (e instanceof UnavailableError) {
        // The fork could not run the batch (error or timeout). ≥ 400, so not settled: nobody pays for the
        // Guardian's own outage, and no HIGH verdict is signed for a batch that was never simulated.
        d.log?.warn({ err: e.detail, endpoint }, "simulation unavailable");
        res.setHeader("Retry-After", "5");
        res.status(503).json({ error: "simulation unavailable, try again in a few seconds" });
        return;
      }
      d.log?.error({ err: (e as Error).message, endpoint }, "check failed");
      // ≥ 400: the x402 middleware does not settle, so the caller is not charged. The cause stays in the
      // log: an internal message (RPC URLs, node errors) is not for callers (P13).
      res.status(502).json({ error: "check failed" });
    }
  };

  app.post("/v1/check", handle("check"));
  app.post("/v1/cosign", handle("cosign"));
  if (d.demoMode)
    app.post("/v1/demo/check", demoRateLimit(d.demoLimit ?? DEFAULT_DEMO_LIMIT), handle("demo"));

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

  // The free read endpoints never show a paid check before its payment settled, and never a verdict signature
  // (the store drops it): a check is stored before the settlement, so both would be free otherwise.
  const read = { settledOnly: d.resourceServer !== null };

  app.get("/v1/checks", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    // `?vault=`: that vault's checks only. The dashboard asks per vault, so checks of other vaults (the free
    // demo endpoint takes any caller) cannot push an owner's HIGH checks off the list (THREAT_MODEL D4).
    const vault = req.query.vault;
    if (vault !== undefined && !(typeof vault === "string" && isAddress(vault))) {
      res.status(400).json({ error: "invalid request", details: "vault must be an address" });
      return;
    }
    res.json({ checks: d.store.recentChecks(limit, { ...read, ...(vault ? { vault } : {}) }) });
  });

  app.get("/v1/checks/:checkId", (req, res) => {
    const row = /^0x[0-9a-fA-F]{64}$/.test(req.params.checkId)
      ? d.store.getCheck(req.params.checkId, read)
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
