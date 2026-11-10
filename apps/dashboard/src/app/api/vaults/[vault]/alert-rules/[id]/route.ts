// PATCH {name?, enabled?, minRisk?, ruleId?, capPercent?} (the kind cannot change) · DELETE.
import { readJson, vaultRoute } from "@/server/http";

export const PATCH = vaultRoute(async (ws, v, p, req) => ({
  rule: ws.updateAlertRule(v, p.id, await readJson(req)),
}));
export const DELETE = vaultRoute((ws, v, p) => ws.deleteAlertRule(v, p.id));
