// Eval case files (docs/SPEC.md §12): eval/cases/<id>.json. Calls are written with a function signature and
// placeholders ({usdc}, {router}, {attacker}, …) so a case reads like what it does; the runner encodes them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeFunctionData,
  getAddress,
  maxUint256,
  parseAbiItem,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { RULE_IDS } from "@guardian402/shared";

const callSchema = z.object({
  target: z.string(),
  /** e.g. "transfer(address,uint256)"; omit for a plain AVAX transfer. */
  fn: z.string().optional(),
  args: z.array(z.string()).default([]),
  value: z.string().default("0"),
});

export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().min(10),
    label: z.enum(["benign", "malicious"]),
    category: z.enum([
      "normal-swap",
      "exact-approval",
      "treasury-transfer",
      "revocation",
      "unlimited-approval",
      "lookalike",
      "drain",
      "bad-slippage",
      "unknown-contract",
      "reverting",
    ]),
    calls: z.array(callSchema).min(1).max(8),
    setup: z
      .object({
        vaultUsdc: z.string().optional(),
        vaultAvax: z.string().optional(),
        approvals: z.array(z.object({ spender: z.string(), amount: z.string() })).optional(),
      })
      .strict()
      .default({}),
    expectedRules: z.array(z.enum(RULE_IDS)),
    /** Vietnamese note shown in the report when the case is a false positive or false negative. */
    note: z.string().optional(),
  })
  .strict();

export type EvalCase = z.infer<typeof caseSchema>;

export function loadCases(dir: string): EvalCase[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const parsed = caseSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!parsed.success) throw new Error(`${f}: ${JSON.stringify(z.flattenError(parsed.error))}`);
    if (`${parsed.data.id}.json` !== f)
      throw new Error(`${f}: id "${parsed.data.id}" does not match the file name`);
    return parsed.data;
  });
}

/** An address with the same first and last `chars` hex characters as `of`, and a different middle. */
export function lookalike(of: Address, chars = 4): Address {
  const body = of.slice(2).toLowerCase();
  const middle = [...body.slice(chars, 40 - chars)]
    .map((c) => ((parseInt(c, 16) + 7) % 16).toString(16))
    .join("");
  return getAddress(`0x${body.slice(0, chars)}${middle}${body.slice(40 - chars)}`);
}

export type Placeholders = Record<string, string>;

const resolve = (s: string, p: Placeholders) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = p[k];
    if (v === undefined) throw new Error(`unknown placeholder {${k}}`);
    return v;
  });

export function placeholders(base: Placeholders): Placeholders {
  return { max: maxUint256.toString(), zero: "0x0000000000000000000000000000000000000000", ...base };
}

/** Calls as the Guardian receives them (CheckRequest.calls). */
export function encodeCalls(c: EvalCase, p: Placeholders): { target: Address; value: string; data: Hex }[] {
  return c.calls.map((call) => {
    const target = getAddress(resolve(call.target, p));
    const value = resolve(call.value, p);
    if (!call.fn) return { target, value, data: "0x" };
    const item = parseAbiItem(`function ${call.fn}`) as AbiFunction;
    const args = call.args.map((raw, i) => {
      const v = resolve(raw, p);
      const type = item.inputs[i]?.type ?? "";
      if (type === "address") return getAddress(v);
      if (type === "bool") return v === "true";
      if (/^uint(8|16|32)$/.test(type)) return Number(v);
      if (type.startsWith("uint") || type.startsWith("int")) return BigInt(v);
      return v;
    });
    return { target, value, data: encodeFunctionData({ abi: [item], args }) };
  });
}

export function resolveSetup(c: EvalCase, p: Placeholders) {
  return {
    vaultUsdc: c.setup.vaultUsdc === undefined ? undefined : resolve(c.setup.vaultUsdc, p),
    vaultAvax: c.setup.vaultAvax === undefined ? undefined : resolve(c.setup.vaultAvax, p),
    approvals: c.setup.approvals?.map((a) => ({
      spender: getAddress(resolve(a.spender, p)),
      amount: BigInt(resolve(a.amount, p)),
    })),
  };
}
