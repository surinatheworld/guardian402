// DELETE: revoke a key (stops calls to the agent API; the agent's wallet authority on the vault is separate).
import { agentApi, vaultRoute } from "@/server/http";

export const DELETE = vaultRoute((_ws, v, p) => ({ key: agentApi().revokeKey(v, p.id, p.keyId) }));
