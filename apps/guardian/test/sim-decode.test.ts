import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  maxUint256,
  parseAbi,
  RawContractError,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { describe, expect, it } from "vitest";
import { mockRouterAbi } from "@guardian402/shared";
import {
  decodeLogs,
  decodeRevert,
  extractRevertData,
  netTransferDelta,
  UNLIMITED_APPROVAL,
} from "../src/sim/decode.ts";
import { Mutex } from "../src/sim/mutex.ts";

const vault: Address = "0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99";
const usdc: Address = "0x5425890298aed601595a70AB815c96711a31Bc65";
const router: Address = "0x263a18Df9E627A862880Ec79E11aAC8671509355";
const attacker: Address = "0x000000000000000000000000000000000000dEaD";
const events = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event NftTransfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

function log(address: Address, topics: Hex[], data: Hex): Log {
  return { address, topics: topics as [Hex, ...Hex[]], data } as Log;
}
const transfer = (token: Address, from: Address, to: Address, value: bigint) =>
  log(
    token,
    encodeEventTopics({ abi: events, eventName: "Transfer", args: { from, to } }) as Hex[],
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );
const approval = (token: Address, owner: Address, spender: Address, value: bigint) =>
  log(
    token,
    encodeEventTopics({ abi: events, eventName: "Approval", args: { owner, spender } }) as Hex[],
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );

describe("decodeLogs", () => {
  it("decodes transfers and the vault's approvals", () => {
    const out = decodeLogs(
      [
        approval(usdc, vault, router, 2_000_000n),
        approval(usdc, attacker, router, 5n), // not the vault's approval
        transfer(usdc, vault, router, 2_000_000n),
      ],
      vault,
    );
    expect(out.transfers).toEqual([{ token: usdc, from: vault, to: router, amount: 2_000_000n }]);
    expect(out.approvals).toEqual([
      { token: usdc, owner: vault, spender: router, amount: 2_000_000n, unlimited: false },
    ]);
  });

  it("flags approvals at or above 2^128 as unlimited", () => {
    const out = decodeLogs(
      [approval(usdc, vault, attacker, maxUint256), approval(usdc, vault, router, UNLIMITED_APPROVAL - 1n)],
      vault,
    );
    expect(out.approvals.map((a) => a.unlimited)).toEqual([true, false]);
  });

  it("decodes ApprovalForAll by the vault", () => {
    const topics = encodeEventTopics({
      abi: events,
      eventName: "ApprovalForAll",
      args: { owner: vault, operator: attacker },
    }) as Hex[];
    const out = decodeLogs([log(router, topics, encodeAbiParameters([{ type: "bool" }], [true]))], vault);
    expect(out.approvalsForAll).toEqual([
      { token: router, owner: vault, operator: attacker, approved: true },
    ]);
  });

  it("skips ERC-721 transfers and unrelated logs", () => {
    const nftTopics = encodeEventTopics({
      abi: events,
      eventName: "NftTransfer",
      args: { from: vault, to: attacker, tokenId: 1n },
    }) as Hex[];
    // An ERC-721 Transfer has the same signature hash but three indexed topics and no data.
    const [transferSig] = encodeEventTopics({ abi: events, eventName: "Transfer" }) as [Hex];
    const erc721 = log(router, [transferSig, ...nftTopics.slice(1)], "0x");
    const other = log(router, [`0x${"ab".repeat(32)}`], "0x");
    expect(decodeLogs([erc721, other], vault)).toEqual({ transfers: [], approvals: [], approvalsForAll: [] });
  });
});

describe("netTransferDelta", () => {
  it("nets inflows and outflows for one token and account", () => {
    const transfers = [
      { token: usdc, from: vault, to: router, amount: 5n },
      { token: usdc, from: router, to: vault, amount: 2n },
      { token: router, from: router, to: vault, amount: 100n },
    ];
    expect(netTransferDelta(transfers, usdc, vault)).toBe(-3n);
    expect(netTransferDelta(transfers, router, vault)).toBe(100n);
  });
});

describe("decodeRevert", () => {
  it("decodes custom errors of the known ABIs", () => {
    const data = encodeErrorResult({ abi: mockRouterAbi, errorName: "InsufficientOutput", args: [10n, 11n] });
    expect(decodeRevert(data)).toBe("InsufficientOutput(10, 11)");
  });

  it("decodes Error(string)", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["ERC20: transfer amount exceeds balance"],
    });
    expect(decodeRevert(data)).toBe("Error(ERC20: transfer amount exceeds balance)");
  });

  it("falls back to raw hex and handles empty data", () => {
    expect(decodeRevert("0xdeadbeef")).toBe("0xdeadbeef");
    expect(decodeRevert("0x")).toBe("reverted without data");
    expect(decodeRevert(undefined)).toBe("reverted without data");
  });

  it("finds revert data inside viem errors", () => {
    expect(extractRevertData(new RawContractError({ data: "0x1234" }))).toBe("0x1234");
    expect(extractRevertData(new Error("plain"))).toBeUndefined();
  });
});

describe("Mutex", () => {
  it("runs tasks one at a time, in order, and survives a failure", async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const task = (name: string, ms: number, fail = false) =>
      mutex.run(async () => {
        order.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([task("a", 20), task("b", 1, true), task("c", 1)]);
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
