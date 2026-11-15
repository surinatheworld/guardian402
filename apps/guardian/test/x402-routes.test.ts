// The paid routes (src/x402.ts): behind a proxy, the x402 resource must be the public URL, not the request's own.
import { describe, expect, it } from "vitest";
import { paidRoutes } from "../src/x402.ts";

const PAY_TO = "0x64281A1b566EB95Ac50c42282Cc257DBD518fB50";

describe("x402 paid routes", () => {
  it("name the public resource URL when GUARDIAN_PUBLIC_URL is set", () => {
    const routes = paidRoutes(PAY_TO, "https://example.test/api/guardian/") as Record<
      string,
      { resource?: string }
    >;
    expect(routes["POST /v1/check"]?.resource).toBe("https://example.test/api/guardian/v1/check");
    expect(routes["POST /v1/cosign"]?.resource).toBe("https://example.test/api/guardian/v1/cosign");
    expect(routes["POST /v1/wallet/check"]?.resource).toBe(
      "https://example.test/api/guardian/v1/wallet/check",
    );
  });

  it("leave the resource to the request URL without it", () => {
    const routes = paidRoutes(PAY_TO) as Record<string, { resource?: string }>;
    expect(routes["POST /v1/cosign"]?.resource).toBeUndefined();
  });
});
