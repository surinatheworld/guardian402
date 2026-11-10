// POST /api/auth/logout: ends this session.
import { assertSameOrigin, clearSession, handle } from "@/server/http";

export async function POST(req: Request) {
  return handle(() => {
    assertSameOrigin(req);
    return clearSession(req);
  });
}
