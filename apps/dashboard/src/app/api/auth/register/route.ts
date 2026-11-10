// POST /api/auth/register {email, password, displayName?} → signs the new account in.
import { accounts, assertSameOrigin, handle, loginLimiter, readJson, withSession } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    loginLimiter.take(`register:${req.headers.get("x-forwarded-for") ?? "local"}`);
    const body = await readJson(req);
    const user = await accounts().register(body);
    return withSession(req, { user }, user.id, "password", null, 201);
  });
}
