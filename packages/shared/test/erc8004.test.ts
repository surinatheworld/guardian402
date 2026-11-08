import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import {
  ERC8004_FUJI,
  ERC8004_REGISTRATION_TYPE,
  GUARDIAN_REPO_URL,
  fromDataUri,
  getErc8004Record,
  guardianRegistration,
  identityRegistryAbi,
  registrationSchema,
  toDataUri,
} from "../src/erc8004/index.ts";

describe("ERC-8004 registration file (registration-v1)", () => {
  it("has every field the spec asks for", () => {
    const r = guardianRegistration(7);
    expect(r.type).toBe(ERC8004_REGISTRATION_TYPE);
    expect(r.name).toBe("Guardian402");
    expect(r.description).toMatch(/x402/);
    expect(r.x402Support).toBe(true);
    expect(r.active).toBe(true);
    expect(r.services).toEqual([{ name: "web", endpoint: GUARDIAN_REPO_URL }]);
    expect(r.registrations).toEqual([
      { agentId: 7, agentRegistry: `eip155:43113:${ERC8004_FUJI.identityRegistry}` },
    ]);
  });

  it("advertises the public API when there is one", () => {
    expect(guardianRegistration(1, "https://guardian.example/").services).toEqual([
      { name: "web", endpoint: "https://guardian.example/v1/health" },
    ]);
  });

  it("round-trips through the on-chain data URI", () => {
    const r = guardianRegistration(42);
    const uri = toDataUri(r);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(fromDataUri(uri)).toEqual(r);
  });

  it("rejects files that miss mandatory fields", () => {
    const r = guardianRegistration(1);
    expect(registrationSchema.safeParse({ ...r, registrations: [] }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...r, type: "registration-v0" }).success).toBe(false);
    expect(
      registrationSchema.safeParse({ ...r, registrations: [{ agentId: 1, agentRegistry: "43113:0x1" }] })
        .success,
    ).toBe(false);
    const { name: _name, ...noName } = r;
    expect(registrationSchema.safeParse(noName).success).toBe(false);
  });

  it("uses the official IdentityRegistry functions", () => {
    const sigs = identityRegistryAbi
      .filter((x) => x.type === "function")
      .map((f) => `${f.name}(${f.inputs.map((i) => i.type).join(",")})`);
    expect(sigs).toEqual(
      expect.arrayContaining(["register()", "setAgentURI(uint256,string)", "tokenURI(uint256)"]),
    );
    expect(toFunctionSelector("register()")).toBe("0x1aa3a008");
  });

  it("the committed Fuji record, if any, stores a valid file bound to its agentId", () => {
    const record = getErc8004Record();
    if (!record) return;
    expect(record.identityRegistry).toBe(ERC8004_FUJI.identityRegistry);
    const file = fromDataUri(record.agentURI);
    expect(file.registrations[0]?.agentId).toBe(record.agentId);
  });
});
