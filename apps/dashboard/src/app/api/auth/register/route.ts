// POST /api/auth/register {email, password, displayName?} → signs the new account in.
import { accounts, assertSameOrigin, handle, limitRegister, readJson, withSession } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    limitRegister(req);
    const body = await readJson(req);
    const user = await accounts().register(body);
    return withSession(req, { user }, user.id, "password", null, 201);
  });
}
