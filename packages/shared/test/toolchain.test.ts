import { describe, expect, it } from "vitest";

// Phase P0 smoke test: proves vitest and the strict TypeScript config run in this workspace.
describe("toolchain", () => {
  it("runs on Node >= 22.13", () => {
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    expect(major > 22 || (major === 22 && minor >= 13)).toBe(true);
  });
});
