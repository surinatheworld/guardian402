// The signed-in user's policy library. GET [?vault=0x… to name addresses from that vault's address book]
// · POST {name, description?, template?, spec, note?} → version 1.
import { policies, readJson, userRoute, workspace } from "@/server/http";

const vaultId = (userId: string, req: Request) => {
  const v = new URL(req.url).searchParams.get("vault");
  return v ? workspace().vault(userId, v).id : undefined;
};

export const GET = userRoute((userId, _p, req) => ({
  policies: policies().list(userId, vaultId(userId, req)),
}));
export const POST = userRoute(
  async (userId, _p, req) => ({
    policy: policies().create(userId, await readJson(req), vaultId(userId, req)),
  }),
  201,
);
