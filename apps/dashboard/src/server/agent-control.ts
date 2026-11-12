// Same-origin proxy to the agent control API (apps/agent/src/control.ts, DEMO only) for a browser on another
// machine. The control API trusts the dashboard's Origin header, which stops web pages but not a script: any
// client can send that header through a public proxy. So the proxy itself decides who may start a scenario and
// how often (the route: visitors under a rate limit, or only the demo vault's signed-in owner), and only then
// adds the headers the control API expects (docs/THREAT_MODEL.md, D2). Nothing from the caller's request is
// forwarded.

export const DEMO_HEADER = "x-guardian402-demo";

export type ControlRequest =
  { kind: "read"; path: "health" | "attempts" } | { kind: "scenario"; id: string } | null;

/** The only requests the proxy knows: GET health, GET attempts, POST scenario/S0..S6. */
export function classifyControl(method: string, path: readonly string[]): ControlRequest {
  const joined = path.join("/");
  if (method === "GET" && (joined === "health" || joined === "attempts"))
    return { kind: "read", path: joined };
  if (method === "POST" && path.length === 2 && path[0] === "scenario" && /^S[0-6]$/.test(path[1] ?? ""))
    return { kind: "scenario", id: path[1] as string };
  return null;
}

/**
 * DEMO_SCENARIOS_PUBLIC: unset or anything but false/0/off/no = any visitor may start a scenario (rate-limited);
 * `false` = only the signed-in owner of the demo vault.
 */
export function scenariosArePublic(value: string | undefined): boolean {
  return !["false", "0", "off", "no"].includes((value ?? "").trim().toLowerCase());
}

export type ControlProxyDeps = {
  /** The control API, e.g. http://127.0.0.1:4403. */
  upstream: string;
  /** The Origin the control API accepts (its DASHBOARD_ORIGIN). */
  origin: string;
  fetch?: typeof fetch;
};

export async function forwardControl(
  r: NonNullable<ControlRequest>,
  limit: string | null,
  d: ControlProxyDeps,
): Promise<{ status: number; body: string }> {
  const base = d.upstream.replace(/\/$/, "");
  const url =
    r.kind === "scenario"
      ? `${base}/scenario/${r.id}`
      : `${base}/${r.path}${r.path === "attempts" && limit && /^\d{1,3}$/.test(limit) ? `?limit=${limit}` : ""}`;
  try {
    const res = await (d.fetch ?? fetch)(url, {
      method: r.kind === "scenario" ? "POST" : "GET",
      headers: r.kind === "scenario" ? { origin: d.origin, [DEMO_HEADER]: "1" } : {},
      cache: "no-store",
      redirect: "error",
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 502, body: JSON.stringify({ error: "agent control API unavailable" }) };
  }
}
