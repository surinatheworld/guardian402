// DELETE: end the agent's current policy assignment (the vault is unchanged; revoke the agent to stop execution).
import { policies, vaultRoute } from "@/server/http";

export const DELETE = vaultRoute((_ws, v, p) => policies().unassign(v, p.id));
