// POST /api/auth/siwe/verify {message, signature}: signs in with the wallet, or links it when signed in.
import {
  accounts,
  assertSameOrigin,
  currentUser,
  handle,
  limitSiwe,
  readJson,
  requestOrigin,
  withSession,
} from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    limitSiwe(req);
    const body = await readJson(req);
    const { host, origin } = requestOrigin(req);
    const current = currentUser(req);
    const r = await accounts().signInWithEthereum({
      message: body.message,
      signature: body.signature,
      host,
      origin,
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
