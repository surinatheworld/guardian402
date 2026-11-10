// POST /api/auth/siwe/verify {message, signature}: signs in with the wallet, or links it when signed in.
import {
  accounts,
  assertSameOrigin,
  currentUser,
  handle,
  loginLimiter,
  readJson,
  withSession,
} from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    loginLimiter.take(`siwe:${req.headers.get("x-forwarded-for") ?? "local"}`);
    const body = await readJson(req);
    const url = new URL(req.url);
    const current = currentUser(req);
    const r = await accounts().signInWithEthereum({
      message: body.message,
      signature: body.signature,
      host: url.host,
      origin: url.origin,
      currentUserId: current?.userId ?? null,
    });
    // Linking a wallet keeps the current session; any other outcome starts a SIWE session.
    if (current && r.outcome !== "created")
      return Response.json(
        { user: r.user, outcome: r.outcome },
        { headers: { "Cache-Control": "no-store" } },
      );
    return withSession(req, { user: r.user, outcome: r.outcome }, r.user.id, "siwe", r.walletId);
  });
}
