// GET /api/setup-info: where the Guardian402 code lives on this machine, so the Agent page can print an MCP
// command that runs as is when the agent runs on the same machine. Only answered to this machine's own browser
// (a public tunnel gets null, so the path of the host is not published).
import { resolve } from "node:path";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function GET(req: Request) {
  const host = req.headers.get("host") ?? "";
  const forwarded = req.headers.get("x-forwarded-host");
  const local = LOCAL.test(host) && (!forwarded || LOCAL.test(forwarded));
  return Response.json(
    { repoRoot: local ? resolve(process.cwd(), "../..").replaceAll("\\", "/") : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
