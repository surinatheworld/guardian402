// Request and response shapes of the Guardian API, exactly as docs/SPEC.md §6.2.
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { FUJI_CHAIN_ID, MAX_CALLS, RISK_LEVELS, RULE_IDS } from "./constants.ts";

const UINT256_MAX = (1n << 256n) - 1n;

/**
 * All lower case, or mixed case with a correct EIP-55 checksum. A wrong checksum is refused here, with a 400:
 * viem's encoders refuse it later anyway, which used to surface as a 502.
 */
export const addressSchema = z
  .string()
  .refine((v) => isAddress(v), "invalid address")
  .transform((v) => v as Address);

export const hexSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "invalid hex bytes")
  .transform((v) => v as Hex);

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32")
  .transform((v) => v as Hex);

/** A uint256 as a decimal string (no sign, no leading zeros, no exponent). */
const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/;
export const uintStringSchema = z
  .string()
  .regex(DECIMAL_UINT, "must be a decimal integer string")
  // zod runs this even when the regex failed, and BigInt("1e3") throws: only size-check what the regex accepted.
  .refine((v) => !DECIMAL_UINT.test(v) || BigInt(v) <= UINT256_MAX, "exceeds uint256");

/** A signed integer as a decimal string (balance deltas). */
export const intStringSchema = z.string().regex(/^-?(0|[1-9][0-9]*)$/, "must be a decimal integer string");

export const riskLevelSchema = z.enum(RISK_LEVELS);
export const riskCodeSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const ruleIdSchema = z.enum(RULE_IDS);

/** Strict: a field the vault does not execute (e.g. a Safe-style `operation`) is refused, not dropped. */
export const callSchema = z
  .object({
    target: addressSchema,
    value: uintStringSchema,
    data: hexSchema,
  })
  .strict();

export const checkRequestSchema = z
  .object({
    chainId: z.literal(FUJI_CHAIN_ID),
    vault: addressSchema,
    calls: z.array(callSchema).min(1).max(MAX_CALLS),
    lang: z.enum(["vi", "en"]).optional(),
  })
  .strict();

/**
 * A transaction from any wallet, checked before the wallet signs it (POST /v1/wallet/check): simulated from that
 * address on the fork and scored with the rules that do not depend on an AgentVault policy. No verdict is signed:
 * there is no vault to enforce one. `addressBook`: addresses the wallet already trusts, for the lookalike rule.
 */
export const walletCheckRequestSchema = z
  .object({
    chainId: z.literal(FUJI_CHAIN_ID),
    wallet: addressSchema,
    calls: z.array(callSchema).min(1).max(MAX_CALLS),
    lang: z.enum(["vi", "en"]).optional(),
    addressBook: z.array(addressSchema).max(20).optional(),
  })
  .strict();
export type WalletCheckRequest = z.infer<typeof walletCheckRequestSchema>;

export const findingSchema = z.object({
  ruleId: ruleIdSchema,
  severity: riskLevelSchema,
  title: z.string(),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const simulationSchema = z.object({
  success: z.boolean(),
  revertReason: z.string().optional(),
  gasUsed: uintStringSchema,
  forkBlock: uintStringSchema,
});

export const diffSchema = z.object({
  tokenDeltas: z.array(
    z.object({
      token: addressSchema,
      symbol: z.string(),
      decimals: z.number().int(),
      delta: intStringSchema,
    }),
  ),
  nativeDelta: intStringSchema, // excludes gas
  approvals: z.array(
    z.object({
      token: addressSchema,
      spender: addressSchema,
      amount: uintStringSchema,
      unlimited: z.boolean(),
    }),
  ),
  transfers: z.array(
    z.object({ token: addressSchema, from: addressSchema, to: addressSchema, amount: uintStringSchema }),
  ),
});

export const explanationSchema = z.object({
  vi: z.string().max(400),
  en: z.string().max(400),
  source: z.enum(["llm", "template"]),
});

export const signedVerdictSchema = z.object({
  callsHash: bytes32Schema,
  nonce: uintStringSchema,
  deadline: z.number().int().nonnegative(),
  risk: riskCodeSchema,
  checkId: bytes32Schema,
  signature: hexSchema,
});

export const checkResponseSchema = z.object({
  checkId: bytes32Schema,
  risk: riskLevelSchema,
  riskCode: riskCodeSchema,
  score: z.number().min(0).max(100),
  findings: z.array(findingSchema),
  simulation: simulationSchema,
  diff: diffSchema,
  explanation: explanationSchema,
  verdict: signedVerdictSchema.optional(),
  latencyMs: z.number().nonnegative(),
  demoMode: z.boolean(),
});

export const errorResponseSchema = z.object({ error: z.string(), details: z.unknown().optional() });

export type CallInput = z.infer<typeof callSchema>;
export type CheckRequest = z.infer<typeof checkRequestSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export type Diff = z.infer<typeof diffSchema>;
export type Explanation = z.infer<typeof explanationSchema>;
export type SignedVerdict = z.infer<typeof signedVerdictSchema>;
export type CheckResponse = z.infer<typeof checkResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
