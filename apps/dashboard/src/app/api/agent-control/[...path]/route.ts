// /api/agent-control/*: the agent control API for a browser on another machine (src/server/agent-control.ts).
// Reads are open, as on the control API itself. Starting a scenario spends the demo vault's testnet USDC and
// can pause it for a moment. By default anyone may start one (the hackathon judges try the demo without a
// wallet), under a rate limit per client and for all visitors together. With DEMO_SCENARIOS_PUBLIC=false only
// a signed-in user whose account holds the demo vault may (linked only when the vault's on-chain owner() is one
// of the user's wallets); that user is never held back by the visitors' limit.
import { deployment } from "@/lib/config";
import { AccountError, isAccountError } from "@/server/accounts";
import { classifyControl, DEMO_HEADER, forwardControl, scenariosArePublic } from "@/server/agent-control";
import {
  assertSameOrigin,
  clientKey,
  currentUser,
  handle,
  RateLimiter,
  requireUser,
  workspace,
} from "@/server/http";

type Context = { params: Promise<{ path: string[] }> };

const WINDOW_MS = 10 * 60 * 1000;
const ownerLimiter = new RateLimiter(30, WINDOW_MS);
// Visitors: a few runs each, and a cap for all of them together (the client key can be made up, see clientKey).
const visitorLimiter = new RateLimiter(6, WINDOW_MS);
const visitorsOverall = new RateLimiter(24, WINDOW_MS);

/** True when the signed-in user's account holds the demo vault. */
function ownsDemoVault(userId: string): boolean {
  try {
    workspace().vault(userId, deployment.vault);
    return true;
  } catch (e) {
    if (!isAccountError(e)) throw e;
    return false;
  }
}

function forward(req: Request, ctx: Context) {
  return handle(async () => {
    // A deployment without the agent control API answers at once instead of a 502 from a missing upstream.
    if (process.env.NEXT_PUBLIC_AGENT_CONTROL === "off")
      return Response.json({ error: "agent control is off on this deployment" }, { status: 404 });
    const { path } = await ctx.params;
    const r = classifyControl(req.method, path);
    if (!r) return Response.json({ error: "not found" }, { status: 404 });
    if (r.kind === "scenario") {
      assertSameOrigin(req);
      if (req.headers.get(DEMO_HEADER) !== "1")
        throw new AccountError(403, "bad_origin", "Yêu cầu không đến từ dashboard này.");
      const user = currentUser(req);
      if (user && ownsDemoVault(user.userId)) {
        ownerLimiter.take(`scenario:${user.userId}`);
      } else if (scenariosArePublic(process.env.DEMO_SCENARIOS_PUBLIC)) {
        visitorLimiter.take(`scenario:${clientKey(req)}`);
        visitorsOverall.take("scenario");
      } else {
        requireUser(req); // 401 when signed out
        throw new AccountError(
          403,
          "not_vault_owner",
          "Chỉ chủ két demo (đã đăng nhập và liên kết két trong Tài khoản) mới chạy được kịch bản.",
        );
      }
    }
    const out = await forwardControl(r, new URL(req.url).searchParams.get("limit"), {
      upstream: process.env.AGENT_PROXY_URL || "http://127.0.0.1:4403",
      origin: process.env.AGENT_PROXY_ORIGIN || "http://localhost:3000",
    });
    return new Response(out.body, {
      status: out.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  });
}

export const GET = forward;
export const POST = forward;
