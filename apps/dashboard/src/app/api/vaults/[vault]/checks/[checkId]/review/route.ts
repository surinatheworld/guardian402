// PUT {status: reviewed|false_positive|escalated, note?}: review a Guardian check of this vault · DELETE.
import { readJson, vaultRoute } from "@/server/http";

export const PUT = vaultRoute(async (ws, v, p, req) =>
  ws.reviewCheck(v, p.checkId ?? "", await readJson(req)),
);
export const DELETE = vaultRoute((ws, v, p) => ws.deleteReview(v, p.checkId ?? ""));
