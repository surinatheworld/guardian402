"use client";
// Scenarios S5 (verdict replay) and S6 (kill switch) end at the vault, not at the Guardian, so a Guardian check
// alone cannot show them. This asks the demo vault itself with eth_call: executeBatch from the vault's agent
// address, nothing signed and nothing sent. S5 hands the vault a verdict for another batch, then one that has
// expired; the vault checks the batch hash, the nonce and the deadline before the signature, so no Guardian key is
// needed to see which check refuses. S6 runs the same call with the vault's `paused` flag set by a state override
// (eth_call only), next to the same call on the vault as it is.
import { createPublicClient, encodeFunctionData, erc20Abi, pad, toHex, type Address, type Hex } from "viem";
import { agentVaultAbi, fujiChain, hashCalls, rpcTransport, type Call } from "@guardian402/shared";
import { deployment, RPC_URL } from "./config";
import { revertName, vaultReasonVi } from "./web-agent";

/** Storage slot 5 holds `guardian` (bytes 0–19) and `paused` (byte 20): `forge inspect AgentVault storageLayout`. */
export const PAUSED_SLOT = toHex(5, { size: 32 });
const PAUSED_BIT = 1n << 160n;

export type VaultStep = {
  /** What the agent sends, in the owner's words. */
  label: string;
  /** The vault error name, or null when the vault would run the batch. */
  error: string | null;
  /** The vault's answer in Vietnamese. */
  answer: string;
  /** True when this step matches what the scenario expects. */
  expected: boolean;
};

export type VaultTrial = { vault: Address; agent: Address; steps: VaultStep[] };

const transfer = (to: Address, amount: bigint): Call[] => [
  {
    target: deployment.usdc,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
  },
];

/** A placeholder signature: the vault refuses S5's verdicts before it recovers the signer. */
const SIGNATURE = `0x${"11".repeat(65)}` as Hex;
const ZERO = `0x${"0".repeat(64)}` as Hex;

/** The paused word for slot 5: the current guardian with the paused byte set. */
export const pausedWord = (slot5: Hex | undefined): Hex =>
  pad(toHex(BigInt(slot5 ?? "0x0") | PAUSED_BIT), { size: 32 });

/** What the vault answers with no error (it would run the batch) or with the given error. */
export function answerOf(error: string | null): string {
  if (error === null) return "Két sẽ thực hiện giao dịch.";
  if (error === "VerdictRequired") return "Két chạy bình thường: khoản này cần phê duyệt của Guardian.";
  if (error === "VerdictExpired") return "Phê duyệt đã quá hạn 60 giây; két không nhận.";
  return vaultReasonVi(error);
}

/** Runs S5 or S6 against the demo vault with eth_call. Throws only when the chain cannot be read. */
export async function runVaultTrial(id: "S5" | "S6"): Promise<VaultTrial> {
  const chain = createPublicClient({ chain: fujiChain, transport: rpcTransport(RPC_URL) });
  const vault = deployment.vault;
  const read = <F extends "agent" | "verdictNonce">(functionName: F) =>
    chain.readContract({ address: vault, abi: agentVaultAbi, functionName });
  const [agent, nonce, block] = await Promise.all([read("agent"), read("verdictNonce"), chain.getBlock()]);

  const call = async (
    calls: Call[],
    verdict: { callsHash: Hex; nonce: bigint; deadline: bigint } | null,
    paused = false,
  ): Promise<string | null> => {
    const v = verdict ? { ...verdict, risk: 0, checkId: ZERO } : null;
    const stateOverride = paused
      ? [
          {
            address: vault,
            stateDiff: [
              {
                slot: PAUSED_SLOT,
                value: pausedWord(await chain.getStorageAt({ address: vault, slot: PAUSED_SLOT })),
              },
            ],
          },
        ]
      : undefined;
    try {
      await chain.simulateContract({
        account: agent,
        address: vault,
        abi: agentVaultAbi,
        functionName: "executeBatch",
        args: [
          calls,
          v ?? { callsHash: ZERO, nonce: 0n, deadline: 0n, risk: 0, checkId: ZERO },
          v ? SIGNATURE : "0x",
        ],
        ...(stateOverride ? { stateOverride } : {}),
      });
      return null;
    } catch (e) {
      return revertName(e);
    }
  };

  const approved = transfer(deployment.deployer, 1_500_000n);
  const step = (label: string, error: string | null, expected: boolean): VaultStep => ({
    label,
    error,
    answer: answerOf(error),
    expected,
  });

  if (id === "S5") {
    const other = transfer(deployment.deployer, 3_000_000n);
    const live = { callsHash: hashCalls(approved), nonce, deadline: block.timestamp + 60n };
    const expired = { ...live, deadline: block.timestamp - 120n };
    const reuse = await call(other, live);
    const late = await call(approved, expired);
    return {
      vault,
      agent,
      steps: [
        step("Dùng phê duyệt của khoản 1,5 USDC cho khoản 3 USDC", reuse, reuse === "InvalidVerdict"),
        step("Gửi đúng khoản 1,5 USDC nhưng phê duyệt đã hết hạn", late, late === "VerdictExpired"),
      ],
    };
  }

  const locked = await call(approved, null, true);
  const open = await call(approved, null);
  return {
    vault,
    agent,
    steps: [
      step("Chủ két khoá két, agent chuyển 1,5 USDC cho Treasury", locked, locked === "Paused"),
      step("Cùng khoản đó khi két không khoá (để so sánh)", open, open !== "Paused"),
    ],
  };
}
