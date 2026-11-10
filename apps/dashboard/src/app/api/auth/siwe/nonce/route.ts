// POST /api/auth/siwe/nonce: a single-use nonce for the EIP-4361 message (valid 5 minutes).
import { FUJI_CHAIN_ID } from "@guardian402/shared";
import { accounts, assertSameOrigin, handle } from "@/server/http";

export async function POST(req: Request) {
  return handle(() => {
    assertSameOrigin(req);
    return Response.json(
      { nonce: accounts().issueNonce(), chainId: FUJI_CHAIN_ID },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
