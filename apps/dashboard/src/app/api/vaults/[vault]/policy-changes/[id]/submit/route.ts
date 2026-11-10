// POST {txHash}: the owner sent the transaction; verify it on chain (vault, calldata, sender, status).
import { readJson, vaultRoute } from "@/server/http";

export const POST = vaultRoute(async (ws, v, p, req) => ({
  change: await ws.submitPolicyChange(v, p.id, await readJson(req)),
}));
