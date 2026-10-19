// Verdict signing (docs/SPEC.md §5). Only the Guardian's signer and test tooling import this module; it is
// deliberately not re-exported from the package index.
import type { Address, Hex, LocalAccount } from "viem";
import { verdictDomain, verdictTypes, type VerdictMessage } from "./verdict.ts";

export async function signVerdict(args: {
  account: LocalAccount;
  vault: Address;
  chainId: number;
  verdict: VerdictMessage;
}): Promise<Hex> {
  return args.account.signTypedData({
    domain: verdictDomain(args.vault, args.chainId),
    types: verdictTypes,
    primaryType: "Verdict",
    message: args.verdict,
  });
}
