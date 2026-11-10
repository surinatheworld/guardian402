// GET: the assignment and the owner transactions that would put it in force (read from the vault now).
import { policies, vaultRoute } from "@/server/http";

export const GET = vaultRoute((_ws, v, p) => policies().plan(v, p.id));
