// PATCH {name?, description?, strategy?, status?} · DELETE (refused while it is the on-chain agent).
import { readJson, vaultRoute } from "@/server/http";

export const PATCH = vaultRoute(async (ws, v, p, req) => ({
  agent: ws.updateAgent(v, p.id, await readJson(req)),
}));
export const DELETE = vaultRoute(async (ws, v, p) => ws.deleteAgent(v, p.id));
