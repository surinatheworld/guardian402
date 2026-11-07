// The verdict signer (docs/SPEC.md §6.3 step 6). Holds GUARDIAN_SIGNER_PK; signs verdicts only, never funds.
// Always signs the true risk: the vault decides what it accepts.
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { RISK_CODE, VERDICT_TTL_SECONDS, type RiskLevel, type SignedVerdict } from "@guardian402/shared";
import { signVerdict } from "@guardian402/shared/sign";

export type VerdictSigner = {
  readonly address: Address;
  sign(args: {
    vault: Address;
    chainId: number;
    callsHash: Hex;
    nonce: bigint;
    risk: RiskLevel;
    checkId: Hex;
    now?: number;
  }): Promise<SignedVerdict>;
};

export function createSigner(privateKey: Hex): VerdictSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async sign({ vault, chainId, callsHash, nonce, risk, checkId, now }) {
      const deadline = Math.floor((now ?? Date.now()) / 1000) + VERDICT_TTL_SECONDS;
      const riskCode = RISK_CODE[risk];
      const signature = await signVerdict({
        account,
        vault,
        chainId,
        verdict: { callsHash, nonce, deadline: BigInt(deadline), risk: riskCode, checkId },
      });
      return { callsHash, nonce: nonce.toString(), deadline, risk: riskCode, checkId, signature };
    },
  };
}
