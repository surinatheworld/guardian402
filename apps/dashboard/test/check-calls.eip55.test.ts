// EIP-55 in the "Kiểm tra ví" and "Chạy thử" inputs: a mixed-case address must carry a valid checksum.
import { describe, expect, it } from "vitest";
import { addressProblem, transferCall } from "../src/lib/check-calls";

const GOOD = "0xe20967C615e442991D468ed7f797edcAeA1771d9";
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";

describe("addressProblem (EIP-55)", () => {
  it("accepts a checksummed address and an all-lowercase one", () => {
    expect(addressProblem(GOOD)).toBeNull();
    expect(addressProblem(GOOD.toLowerCase())).toBeNull();
  });

  it("refuses a wrong checksum, all-uppercase hex, and a wrong length", () => {
    const flipped = GOOD.replace("C615", "c615");
    expect(addressProblem(flipped)).toMatch(/checksum EIP-55/);
    expect(addressProblem(`0x${GOOD.slice(2).toUpperCase()}`)).toMatch(/checksum EIP-55/);
    expect(addressProblem(GOOD.slice(0, -1))).toMatch(/40 ký tự/);
  });

  it("blocks a transfer to a mis-cased recipient before anything is sent", () => {
    const r = transferCall(USDC, 6, GOOD.replace("C615", "c615"), "1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Người nhận không hợp lệ: sai checksum/);
  });
});
