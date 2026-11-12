// /api/agent-control/*: the agent control API for a browser on another machine (src/server/agent-control.ts).
// Reads are open, as on the control API itself. Starting a scenario spends the demo vault's testnet USDC and
// can pause it, so it needs a signed-in user whose account holds the demo vault (linked only when the vault's
// on-chain owner() is one of the user's wallets).
import { deployment } from "@/lib/config";
import { AccountError, isAccountError } from "@/server/accounts";
import { classifyControl, DEMO_HEADER, forwardControl } from "@/server/agent-control";
import { assertSameOrigin, handle, RateLimiter, requireUser, workspace } from "@/server/http";

type Context = { params: Promise<{ path: string[] }> };

const scenarioLimiter = new RateLimiter(30, 10 * 60 * 1000);

function forward(req: Request, ctx: Context) {
  return handle(async () => {
    const { path } = await ctx.params;
    const r = classifyControl(req.method, path);
    if (!r) return Response.json({ error: "not found" }, { status: 404 });
    if (r.kind === "scenario") {
      assertSameOrigin(req);
      if (req.headers.get(DEMO_HEADER) !== "1")
        throw new AccountError(403, "bad_origin", "Yêu cầu không đến từ dashboard này.");
      const { userId } = requireUser(req);
      try {
        workspace().vault(userId, deployment.vault);
      } catch (e) {
        if (!isAccountError(e)) throw e;
        throw new AccountError(
          403,
          "not_vault_owner",
          "Chỉ chủ két demo (đã đăng nhập và liên kết két trong Tài khoản) mới chạy được kịch bản.",
        );
      }
      scenarioLimiter.take(`scenario:${userId}`);
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
