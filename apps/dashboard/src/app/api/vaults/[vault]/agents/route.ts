// Agents of a linked vault. GET: registry + the on-chain agent(). POST {name, address, description?, strategy?}.
import { readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute((ws, v) => ws.listAgents(v));
export const POST = vaultRoute(
  async (ws, v, _p, req) => ({ agent: ws.createAgent(v, await readJson(req)) }),
  201,
);
