// GET /api/auth/me: the signed-in account with its wallets, vaults and recent security events; 401 otherwise.
import { accounts, handle, requireUser } from "@/server/http";

export async function GET(req: Request) {
  return handle(() => {
    const { userId, method } = requireUser(req);
    return Response.json(
      { ...accounts().me(userId), session: { method } },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
