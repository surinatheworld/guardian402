// GET: the change, re-verified on chain if it is still pending · PATCH {params?, note?} (drafts) · DELETE: cancel a draft.
import { readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute(async (ws, v, p) => ({ change: await ws.refreshPolicyChange(v, p.id) }));
export const PATCH = vaultRoute(async (ws, v, p, req) => ({
  change: ws.updatePolicyChange(v, p.id, await readJson(req)),
}));
export const DELETE = vaultRoute((ws, v, p) => ({ change: ws.cancelPolicyChange(v, p.id) }));
