// Guardian API keys of an agent. GET: list (never the key itself). POST {name?}: new key, shown once.
import { agentApi, readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute((_ws, v, p) => ({ keys: agentApi().listKeys(v, p.id) }));
export const POST = vaultRoute(
  async (_ws, v, p, req) => agentApi().createKey(v, p.id, await readJson(req)),
  201,
);
