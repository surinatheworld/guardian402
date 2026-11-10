// Owner policy changes. POST {kind, params, note?} prepares a draft and returns the exact transaction
// (to, data) the owner's wallet must send; nothing changes on chain until the owner signs it.
import { readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute((ws, v) => ({ changes: ws.listPolicyChanges(v) }));
export const POST = vaultRoute(
  async (ws, v, _p, req) => ({ change: ws.createPolicyChange(v, await readJson(req)) }),
  201,
);
