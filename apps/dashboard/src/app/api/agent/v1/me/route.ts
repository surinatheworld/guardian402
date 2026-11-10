// Agent API: who am I, my effective policy, whether the vault enforces it, today's budget.
import { agentApi, agentRoute } from "@/server/http";

export const GET = agentRoute((p) => agentApi().me(p));
