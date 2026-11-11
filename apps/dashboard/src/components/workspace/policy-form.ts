import { formatUnits, parseUnits, type Address } from "viem";
import { ASSETS } from "@/lib/policy-catalog";
import { parseSpec, type PolicySpec } from "@/lib/policy-spec";

export type AssetRow = {
  key: string;
  token: Address | "native";
  symbol: string;
  decimals: number;
  demo: boolean;
};

export const NATIVE_ASSET: AssetRow = {
  key: "native",
  token: "native",
  symbol: "AVAX",
  decimals: 18,
  demo: false,
};

export function assetRows(...specs: PolicySpec[]): AssetRow[] {
  const rows: AssetRow[] = [...ASSETS.map((a) => ({ ...a, key: a.token.toLowerCase() })), NATIVE_ASSET];
  for (const spec of specs) {
    for (const { token } of spec.tokens) {
      const key = token.toLowerCase();
      if (!rows.some((row) => row.key === key)) {
        // Older or API-created policies may include tokens with no catalog metadata.
        rows.push({
          key,
          token,
          symbol: `${token.slice(0, 8)}…${token.slice(-4)} (đơn vị gốc)`,
          decimals: 0,
          demo: false,
        });
      }
    }
  }
  return rows;
}

type AssetForm = { enabled: boolean; cap: string; threshold: string; maxApproval: string };
export type PolicyForm = Omit<PolicySpec, "tokens" | "native"> & { assets: Record<string, AssetForm> };
export const OFF: AssetForm = { enabled: false, cap: "0", threshold: "0", maxApproval: "0" };

export function toForm(s: PolicySpec, rows: AssetRow[]): PolicyForm {
  const { tokens, native, ...permissions } = s;
  const assets: PolicyForm["assets"] = {};
  for (const row of rows) {
    const token = tokens.find((t) => t.token.toLowerCase() === row.key);
    const rule = row.token === "native" ? native : token;
    assets[row.key] = rule
      ? {
          enabled: row.token !== "native" || rule.dailyCap !== "0" || rule.verdictThreshold !== "0",
          cap: formatUnits(BigInt(rule.dailyCap), row.decimals),
          threshold: formatUnits(BigInt(rule.verdictThreshold), row.decimals),
          maxApproval: formatUnits(BigInt(token?.maxApproval ?? "0"), row.decimals),
        }
      : OFF;
  }
  return { ...permissions, assets };
}

export function units(value: string, decimals: number, label: string): bigint {
  const text = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`${label} phải là số từ 0 trở lên.`);
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.replace(/0+$/, "").length > decimals)
    throw new Error(`${label} chỉ hỗ trợ tối đa ${decimals} chữ số thập phân.`);
  if (whole.replace(/^0+/, "").length > 78) throw new Error(`${label} vượt phạm vi cho phép.`);
  const amount = parseUnits(text, decimals);
  if (amount >= 2n ** 256n) throw new Error(`${label} vượt phạm vi cho phép.`);
  return amount;
}

function budgetValue(row: AssetRow, asset: AssetForm, field: "cap" | "threshold"): string {
  const label = field === "cap" ? "Ngân sách" : "Ngưỡng verdict";
  return units(asset[field], row.decimals, `${label} ${row.symbol}`).toString();
}

export function firstBudgetIssue(form: PolicyForm, rows: AssetRow[]) {
  for (const row of rows) {
    const asset = form.assets[row.key];
    if (!asset?.enabled) continue;
    for (const field of ["cap", "threshold"] as const) {
      try {
        budgetValue(row, asset, field);
      } catch (error) {
        return {
          field: `${field}-${row.key}`,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return null;
}

export function toSpec(form: PolicyForm, rows: AssetRow[], vault: Address): PolicySpec {
  const { assets, ...permissions } = form;
  const tokens: PolicySpec["tokens"] = [];
  let native = { dailyCap: "0", verdictThreshold: "0" };
  for (const row of rows) {
    const asset = assets[row.key];
    if (!asset?.enabled) continue;
    const dailyCap = budgetValue(row, asset, "cap");
    const verdictThreshold = budgetValue(row, asset, "threshold");
    if (row.token === "native") native = { dailyCap, verdictThreshold };
    else
      tokens.push({
        token: row.token,
        dailyCap,
        verdictThreshold,
        maxApproval: units(asset.maxApproval, row.decimals, `Mức approval ${row.symbol}`).toString(),
      });
  }
  return parseSpec({ ...permissions, tokens, native }, vault);
}
