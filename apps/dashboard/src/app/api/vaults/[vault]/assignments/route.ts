// GET: every agent of the vault with its assigned policy and whether the vault enforces it, plus today's
// spending. POST {agentId, policyId, version?}: assign (replaces the agent's current assignment).
import { policies, readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute((_ws, v) => policies().overview(v));
export const POST = vaultRoute(
  async (_ws, v, _p, req) => ({ assignment: policies().assign(v, await readJson(req)) }),
  201,
);
