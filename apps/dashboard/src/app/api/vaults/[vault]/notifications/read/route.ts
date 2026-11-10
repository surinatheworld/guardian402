// POST {ids: number[]} or {all: true}: mark notifications as read.
import { readJson, vaultRoute } from "@/server/http";

export const POST = vaultRoute(async (ws, v, _p, req) => ws.markRead(v, await readJson(req)));
