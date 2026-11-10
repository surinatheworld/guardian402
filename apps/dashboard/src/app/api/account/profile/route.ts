// PATCH /api/account/profile {displayName?, locale?}.
import { accounts, assertSameOrigin, handle, readJson, requireUser } from "@/server/http";

export async function PATCH(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const { userId } = requireUser(req);
    return Response.json({ user: accounts().updateProfile(userId, await readJson(req)) });
  });
}
