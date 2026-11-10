// Agent API: POST {calls, lang?} → the Guardian's paid /v1/check for the agent's vault (x402 passes through).
import { agentRoute } from "@/server/http";
import { forwardCheck } from "@/server/guardian-proxy";

export const POST = agentRoute((p, _params, req) => forwardCheck(p, "check", req));
