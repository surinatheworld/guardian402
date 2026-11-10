// Address book of a linked vault, with the live on-chain allowlist state of each address.
// POST {name, address, kind?, note?, confirmLookalike?}: lookalikes of trusted addresses are refused (409).
import { readJson, vaultRoute } from "@/server/http";

export const GET = vaultRoute(async (ws, v) => ({ contacts: await ws.listContacts(v) }));
export const POST = vaultRoute(
  async (ws, v, _p, req) => ({ contact: ws.createContact(v, await readJson(req)) }),
  201,
);
