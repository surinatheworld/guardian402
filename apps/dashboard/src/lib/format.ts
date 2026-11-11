// Display helpers. Vietnamese number format (comma decimal separator), as in the Guardian's explanations.
import { formatUnits } from "viem";

const num = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 });
const time = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" });

/** A raw token amount as a Vietnamese decimal string, at most `maxFraction` digits after the comma. */
export function formatAmount(raw: bigint | string, decimals: number, maxFraction = 4): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const [whole = "0", fraction = ""] = formatUnits(negative ? -value : value, decimals).split(".");
  const cut = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return `${negative ? "-" : ""}${num.format(BigInt(whole))}${cut ? `,${cut}` : ""}`;
}

/** 2^255 and above reads as "unlimited" (the rule's own threshold is lower; see /v1/rules). */
export const isUnlimited = (raw: bigint | string) => BigInt(raw) >= 2n ** 255n;

export const shortHex = (hex: string, head = 6, tail = 4) =>
  hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;

export const formatTime = (ms: number) => time.format(new Date(ms));

export const formatCount = (n: number) => num.format(n);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** A NumberField value (a JS number) as raw token units, without float noise (at most 6 decimals). */
export function toUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value < 0) return 0n;
  const text = value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: Math.min(decimals, 6),
  });
  const [whole = "0", fraction = ""] = text.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

/** Raw token units as a JS number, for NumberField defaults (display only). */
export const fromUnits = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
