// GET ?limit=: the vault's recent Guardian checks, each with the owner's review.
import { vaultRoute } from "@/server/http";

export const GET = vaultRoute(async (ws, v, _p, req) => ({
  checks: await ws.listChecks(v, Number(new URL(req.url).searchParams.get("limit")) || 50),
}));
