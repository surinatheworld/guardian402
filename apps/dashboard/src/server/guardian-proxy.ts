// Forwards an agent's check/cosign to the Guardian API. The Guardian charges per request over x402 and the
// agent pays with its own wallet: the x402 headers pass through unchanged in both directions, so a 402 with
// PAYMENT-REQUIRED reaches the agent's x402 client, which retries with PAYMENT-SIGNATURE. This server never
// holds or signs a payment.
import { GUARDIAN_URL } from "@/lib/config";
import { AccountError } from "./accounts";
import { PAYMENT_REQUEST_HEADERS, PAYMENT_RESPONSE_HEADERS, type AgentPrincipal } from "./agent-api";
import { agentApi, readJson } from "./http";

const TIMEOUT_MS = 60_000; // a check simulates the batch on a fork; the Guardian answers 503 when it is busy

export async function forwardCheck(p: AgentPrincipal, endpoint: "check" | "cosign", req: Request) {
  const body = await agentApi().prepareCheck(p, endpoint, await readJson(req));
  const headers = new Headers({ "content-type": "application/json" });
  for (const h of PAYMENT_REQUEST_HEADERS) {
    const value = req.headers.get(h);
    if (value) headers.set(h, value);
  }
  let res: Response;
  try {
    res = await fetch(`${GUARDIAN_URL}/v1/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AccountError(503, "guardian_unavailable", "Không gọi được Guardian lúc này. Thử lại sau.");
  }
  const out = new Headers({
    "content-type": res.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  for (const h of PAYMENT_RESPONSE_HEADERS) {
    const value = res.headers.get(h);
    if (value) out.set(h, value);
  }
  const retry = res.headers.get("retry-after");
  if (retry) out.set("retry-after", retry);
  return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
}
