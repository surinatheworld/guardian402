// POST /api/account/vaults {address, label?}: link an AgentVault whose on-chain owner() is one of your wallets.
import { accounts, assertSameOrigin, handle, readJson, requireUser } from "@/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const { userId } = requireUser(req);
    const vault = await accounts().linkVault(userId, await readJson(req));
    return Response.json({ vault }, { status: 201 });
  });
}
