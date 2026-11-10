// Agent API: POST {calls, lang?} → the Guardian's paid /v1/cosign; refused unless the policy is in force.
import { agentRoute } from "@/server/http";
import { forwardCheck } from "@/server/guardian-proxy";

export const POST = agentRoute((p, _params, req) => forwardCheck(p, "cosign", req));
