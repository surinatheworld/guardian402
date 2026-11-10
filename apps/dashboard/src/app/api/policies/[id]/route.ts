// One policy with all its versions. PATCH {name?, description?, spec?, note?}: new rules make a new version.
// DELETE archives it (refused while an agent is assigned to it).
import { policies, readJson, userRoute, workspace } from "@/server/http";

const vaultId = (userId: string, req: Request) => {
  const v = new URL(req.url).searchParams.get("vault");
  return v ? workspace().vault(userId, v).id : undefined;
};

export const GET = userRoute((userId, p, req) => ({
  policy: policies().get(userId, p.id, vaultId(userId, req)),
}));
export const PATCH = userRoute(async (userId, p, req) =>
  policies().update(userId, p.id, await readJson(req), vaultId(userId, req)),
);
export const DELETE = userRoute((userId, p) => policies().archive(userId, p.id));
