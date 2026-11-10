// Agent API: one Guardian check of the agent's vault (risk, findings, explanation).
import { agentApi, agentRoute } from "@/server/http";

export const GET = agentRoute((p, params) => agentApi().check(p, params.checkId ?? ""));
