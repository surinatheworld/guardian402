import { describe, expect, it } from "vitest";
import { getAddresses, parseNetwork } from "../src/addresses.ts";
import { FUJI_CAIP2, PRICES, RISK_CODE, RULE_IDS, USDC_FUJI, riskFromCode, txUrl } from "../src/constants.ts";
import { agentVaultAbi } from "../src/abi/index.ts";

describe("addresses", () => {
  it("loads both networks with the Fuji USDC", () => {
    for (const network of ["local", "fuji"] as const) {
      const a = getAddresses(network);
      expect(a.network).toBe(network);
      expect(a.chainId).toBe(43113);
      expect(a.usdc).toBe(USDC_FUJI.address);
    }
  });

  it("parses NETWORK", () => {
    expect(parseNetwork(undefined)).toBe("local");
    expect(parseNetwork("fuji")).toBe("fuji");
    expect(() => parseNetwork("mainnet")).toThrow(/NETWORK must be one of/);
  });
});

describe("constants", () => {
  it("match SPEC §2, §6.1 and §8", () => {
    expect(FUJI_CAIP2).toBe("eip155:43113");
    expect(USDC_FUJI).toMatchObject({ decimals: 6, eip712Name: "USD Coin", eip712Version: "2" });
    expect(PRICES).toEqual({ check: "5000", cosign: "10000" });
    expect(RULE_IDS).toHaveLength(8);
    expect(RISK_CODE).toEqual({ LOW: 0, MEDIUM: 1, HIGH: 2 });
    expect(riskFromCode(2)).toBe("HIGH");
    expect(txUrl("0xab")).toBe("https://testnet.snowtrace.io/tx/0xab");
  });

  it("exports the generated AgentVault ABI", () => {
    const names = agentVaultAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining(["executeBatch", "getPolicy", "verdictDigest", "hashCalls"]),
    );
  });
});

describe("RPC fallback (P14)", async () => {
  const { FUJI_RPC_FALLBACK_URL, rpcUrls } = await import("../src/rpc.ts");
  it("adds the other public Fuji endpoints behind a remote primary", () => {
    expect(rpcUrls("https://my-provider.example/key")).toEqual([
      "https://my-provider.example/key",
      "https://api.avax-test.network/ext/bc/C/rpc",
      FUJI_RPC_FALLBACK_URL,
    ]);
    expect(rpcUrls(FUJI_RPC_FALLBACK_URL)).toHaveLength(2);
  });
  it("never falls back away from a local fork", () => {
    expect(rpcUrls("http://127.0.0.1:8545")).toEqual(["http://127.0.0.1:8545"]);
    expect(rpcUrls("http://localhost:8545")).toEqual(["http://localhost:8545"]);
  });
});
