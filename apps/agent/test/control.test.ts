// P13 (docs/THREAT_MODEL.md, F5): only the dashboard can start a scenario on the agent control API.
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createControlApp, DEMO_HEADER } from "../src/control.ts";

const ORIGIN = "http://localhost:3000";
let server: Server;
let port = 0;
const runs: string[] = [];

beforeAll(async () => {
  // The Host check needs the real port, so bind first and build the app on that port.
  const probe = (await import("node:http")).createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const app = createControlApp({
    origin: ORIGIN,
    port,
    health: () => ({ ok: true }),
    attempts: () => [],
    run: async (id) => {
      runs.push(id);
      return { scenario: id };
    },
  });
  server = app.listen(port, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** Raw HTTP so the test controls the Host and Origin headers exactly as a browser would send them. */
function call(method: string, path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
const host = () => `127.0.0.1:${port}`;

describe("agent control API", () => {
  it("runs a scenario for the dashboard", async () => {
    const r = await call("POST", "/scenario/s1", { host: host(), origin: ORIGIN, [DEMO_HEADER]: "1" });
    expect(r.status).toBe(200);
    expect(runs).toEqual(["S1"]);
  });

  it("refuses a POST from another site (a page the owner happens to have open)", async () => {
    const r = await call("POST", "/scenario/S2", {
      host: host(),
      origin: "https://evil.example",
      [DEMO_HEADER]: "1",
    });
    expect(r.status).toBe(403);
  });

  it("refuses a simple cross-site POST without the demo header", async () => {
    const r = await call("POST", "/scenario/S2", { host: host(), origin: ORIGIN });
    expect(r.status).toBe(403);
  });

  it("refuses a POST with no Origin (not a browser on the dashboard)", async () => {
    const r = await call("POST", "/scenario/S2", { host: host(), [DEMO_HEADER]: "1" });
    expect(r.status).toBe(403);
  });

  it("refuses a rebound host name (DNS rebinding)", async () => {
    const r = await call("GET", "/attempts", { host: `evil.example:${port}` });
    expect(r.status).toBe(403);
    const post = await call("POST", "/scenario/S1", {
      host: `evil.example:${port}`,
      origin: ORIGIN,
      [DEMO_HEADER]: "1",
    });
    expect(post.status).toBe(403);
  });

  it("lets only the dashboard pass the CORS preflight", async () => {
    const ok = await call("OPTIONS", "/scenario/S1", {
      host: host(),
      origin: ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": DEMO_HEADER,
    });
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(ok.headers["access-control-allow-headers"]).toBe(DEMO_HEADER);
    const bad = await call("OPTIONS", "/scenario/S1", { host: host(), origin: "https://evil.example" });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ran nothing but the dashboard's request", () => {
    expect(runs).toEqual(["S1"]);
  });
});
