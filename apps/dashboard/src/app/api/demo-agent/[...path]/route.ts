// Local preview adapter for an explicitly configured demo agent. Scenario POSTs are accepted only from
// this localhost dashboard and retain the agent's required custom header.
type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return Response.json({ error: "forbidden host" }, { status: 403 });
  }
  const { path } = await context.params;
  const read = request.method === "GET" && (path.join("/") === "health" || path.join("/") === "attempts");
  const run =
    request.method === "POST" &&
    path.length === 2 &&
    path[0] === "scenario" &&
    /^S[0-6]$/.test(path[1] ?? "");
  if (!read && !run) return Response.json({ error: "not found" }, { status: 404 });
  if (
    run &&
    (request.headers.get("origin") !== url.origin || request.headers.get("x-guardian402-demo") !== "1")
  ) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }
  const upstream = process.env.DEMO_AGENT_UPSTREAM;
  const origin = process.env.DEMO_AGENT_ORIGIN;
  if (!upstream || !origin) return Response.json({ error: "demo agent not configured" }, { status: 503 });
  try {
    const target = new URL(`${upstream.replace(/\/$/, "")}/${path.join("/")}`);
    if (target.protocol !== "https:") throw new Error("invalid upstream");
    target.search = url.search;
    const res = await fetch(target, {
      method: request.method,
      headers: run ? { origin, "x-guardian402-demo": "1" } : {},
      cache: "no-store",
      redirect: "error",
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "demo agent unavailable" }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
