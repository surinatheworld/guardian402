// Sends batches to AgentVault. A batch the vault will reject is still sent (with a fixed gas limit) so the
// revert is visible on the explorer; its reason is read first with a simulation.
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { agentVaultAbi, type Call, type SignedVerdict } from "@guardian402/shared";

export type VaultOutcome = {
  tx?: Hex;
  status: "success" | "reverted" | "not-sent";
  revert?: string;
  revertArgs?: string;
};

const EMPTY_VERDICT = {
  callsHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: 0n,
  deadline: 0n,
  risk: 0,
  checkId: "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const;

export function verdictArgs(v: SignedVerdict | undefined) {
  if (!v) return { verdict: EMPTY_VERDICT, signature: "0x" as Hex };
  return {
    verdict: {
      callsHash: v.callsHash,
      nonce: BigInt(v.nonce),
      deadline: BigInt(v.deadline),
      risk: v.risk,
      checkId: v.checkId,
    },
    signature: v.signature,
  };
}

function revertOf(e: unknown): { name: string; args?: string } {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  if (r instanceof ContractFunctionRevertedError) {
    return {
      name: r.data?.errorName ?? r.reason ?? "unknown",
      ...(r.data?.args ? { args: r.data.args.map(String).join(", ") } : {}),
    };
  }
  return { name: e instanceof Error ? ((e as BaseError).shortMessage ?? e.message) : String(e) };
}

export async function executeBatch(
  chain: PublicClient,
  wallet: WalletClient,
  vault: Address,
  calls: Call[],
  verdict: SignedVerdict | undefined,
): Promise<VaultOutcome> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const { verdict: v, signature } = verdictArgs(verdict);
  const args = [calls, v, signature] as const;
  let revert: { name: string; args?: string } | undefined;
  try {
    await chain.simulateContract({
      account,
      address: vault,
      abi: agentVaultAbi,
      functionName: "executeBatch",
      args,
    });
  } catch (e) {
    revert = revertOf(e);
  }
  const hash = await wallet.writeContract({
    account,
    chain: wallet.chain,
    address: vault,
    abi: agentVaultAbi,
    functionName: "executeBatch",
    args,
    ...(revert ? { gas: 600_000n } : {}),
  });
  const receipt = await chain.waitForTransactionReceipt({ hash });
  if (receipt.status === "success") return { tx: hash, status: "success" };
  return {
    tx: hash,
    status: "reverted",
    revert: revert?.name ?? "unknown",
    ...(revert?.args ? { revertArgs: revert.args } : {}),
  };
}

export async function setPaused(
  chain: PublicClient,
  owner: WalletClient,
  vault: Address,
  paused: boolean,
): Promise<Hex> {
  const account = owner.account;
  if (!account) throw new Error("owner wallet has no account");
  const hash = await owner.writeContract({
    account,
    chain: owner.chain,
    address: vault,
    abi: agentVaultAbi,
    functionName: paused ? "pause" : "unpause",
  });
  await chain.waitForTransactionReceipt({ hash });
  return hash;
}
