// DELETE /api/account/wallets/:address: unlink a wallet (never the last way to sign in).
import { accounts, assertSameOrigin, handle, requireUser } from "@/server/http";

export async function DELETE(req: Request, ctx: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { userId } = requireUser(req);
    accounts().unlinkWallet(userId, (await ctx.params).address);
    return Response.json({ ok: true });
  });
}
