// DELETE /api/account/vaults/:address: unlink a vault (nothing changes on chain).
import { accounts, assertSameOrigin, handle, requireUser } from "@/server/http";

export async function DELETE(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { userId } = requireUser(req);
    accounts().unlinkVault(userId, (await ctx.params).address);
    return Response.json({ ok: true });
  });
}
