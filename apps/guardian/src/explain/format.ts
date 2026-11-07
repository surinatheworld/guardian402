import { formatUnits } from "viem";
import { MAX_EXPLANATION_CHARS, type ExplainInput } from "./types.ts";

export type Lang = "vi" | "en";

/** 0x1234…abcd, or the trusted name when there is one. */
export function label(input: ExplainInput, address: string | number | boolean | undefined): string {
  const a = String(address ?? "");
  const name = input.names[a.toLowerCase()];
  if (name) return name;
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?";
}

/** Raw token units → "2 USDC" (vi uses a decimal comma). At most 6 fraction digits. */
export function amount(
  input: ExplainInput,
  token: string | number | boolean | undefined,
  raw: string | number | boolean | undefined,
  lang: Lang,
): string {
  const key = String(token ?? "").toLowerCase();
  const isNative = key === "0x0000000000000000000000000000000000000000";
  const meta = isNative ? { symbol: "AVAX", decimals: 18 } : input.tokens[key];
  let value: bigint;
  try {
    value = BigInt(String(raw ?? "0"));
  } catch {
    value = 0n;
  }
  const neg = value < 0n;
  if (neg) value = -value;
  const decimals = meta?.decimals ?? 18;
  let text = formatUnits(value, decimals);
  const [int, frac = ""] = text.split(".");
  text = frac ? `${int}.${frac.slice(0, 6).replace(/0+$/, "")}`.replace(/\.$/, "") : (int ?? "0");
  if (lang === "vi") text = text.replace(".", ",");
  return `${neg ? "-" : ""}${text} ${meta?.symbol ?? "token"}`;
}

export function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= MAX_EXPLANATION_CHARS ? t : `${t.slice(0, MAX_EXPLANATION_CHARS - 1).trimEnd()}…`;
}
