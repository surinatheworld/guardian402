// PATCH {name?, kind?, note?} (the address cannot change) · DELETE.
import { readJson, vaultRoute } from "@/server/http";

export const PATCH = vaultRoute(async (ws, v, p, req) => ({
  contact: ws.updateContact(v, p.id, await readJson(req)),
}));
export const DELETE = vaultRoute((ws, v, p) => ws.deleteContact(v, p.id));
