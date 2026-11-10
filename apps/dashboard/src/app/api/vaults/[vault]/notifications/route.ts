// GET ?unread=1: evaluates the alert rules first (idempotent), then lists notifications. `sync` tells whether
// the Guardian and the chain could be read.
import { vaultRoute } from "@/server/http";

export const GET = vaultRoute(async (ws, v, _p, req) => {
  const sync = await ws.syncAlerts(v);
  return { sync, ...ws.listNotifications(v, new URL(req.url).searchParams.get("unread") === "1") };
});
