// POST /api/auth/login {email, password}.
import { accounts, assertSameOrigin, handle, limitLogin, readJson, withSession } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    limitLogin(req, email);
    const user = await accounts().loginWithPassword(body);
    return withSession(req, { user }, user.id, "password", null);
  });
}
