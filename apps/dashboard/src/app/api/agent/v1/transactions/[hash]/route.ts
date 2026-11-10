// Agent API: the verified outcome of a transaction (pending, reverted, executed by the vault, …).
import { agentApi, agentRoute } from "@/server/http";

export const GET = agentRoute((p, params) => agentApi().execution(p, params.hash ?? ""));
