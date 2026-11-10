// POST: draft the owner transactions of the plan (replacing unsent drafts of this assignment). Each draft is
// signed in the owner's wallet and verified on chain like any policy change.
import { policies, vaultRoute } from "@/server/http";

export const POST = vaultRoute((_ws, v, p) => policies().apply(v, p.id));
