// Verdict encoding shared with AgentVault (docs/SPEC.md §5). TypeScript and Solidity must match byte for byte;
// `pnpm test:crosscheck` proves it. Signing lives in ./sign.ts so modules that must not sign (the explainer)
// can use these helpers without importing a signer.
import { encodeAbiParameters, keccak256, recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { CallInput } from "./schemas.ts";
import type { RiskCode } from "./constants.ts";

export type Call = { target: Address; value: bigint; data: Hex };

export type VerdictMessage = {
  callsHash: Hex;
  nonce: bigint;
  deadline: bigint; // uint64, unix seconds
  risk: RiskCode;
  checkId: Hex;
};

export const CALL_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const hashCalls = (calls: readonly Call[]): Hex =>
  keccak256(encodeAbiParameters([CALL_TUPLE], [calls]));

export const verdictTypes = {
  Verdict: [
    { name: "callsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "risk", type: "uint8" },
    { name: "checkId", type: "bytes32" },
  ],
} as const;

export const verdictDomain = (vault: Address, chainId: number) =>
  ({ name: "Guardian402 AgentVault", version: "1", chainId, verifyingContract: vault }) as const;

/** API calls carry `value` as a decimal string; the contract and the hash use uint256. */
export const toCalls = (calls: readonly CallInput[]): Call[] =>
  calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data }));

export async function recoverVerdictSigner(args: {
  vault: Address;
  chainId: number;
  verdict: VerdictMessage;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: verdictDomain(args.vault, args.chainId),
    types: verdictTypes,
    primaryType: "Verdict",
    message: args.verdict,
    signature: args.signature,
  });
}
