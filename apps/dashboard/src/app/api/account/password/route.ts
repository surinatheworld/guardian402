// POST /api/account/password {password, currentPassword?, email?}: add or change email + password.
// Every other session of the account is ended.
import { accounts, assertSameOrigin, handle, readJson, requireUser, sessionToken } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const { userId } = requireUser(req);
    const svc = accounts();
    await svc.setPassword(userId, await readJson(req));
    svc.destroyOtherSessions(userId, sessionToken(req) ?? undefined);
    return Response.json({ ok: true });
  });
}
