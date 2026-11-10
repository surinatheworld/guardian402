// POST /api/auth/login {email, password}.
import { accounts, assertSameOrigin, handle, loginLimiter, readJson, withSession } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    loginLimiter.take(`login:${email}`);
    const user = await accounts().loginWithPassword(body);
    return withSession(req, { user }, user.id, "password", null);
  });
}
