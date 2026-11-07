// Turns a SimResult into the normalized `diff` of the API response (docs/SPEC.md §6.2). Only what the vault
// gains, loses and grants: no calldata, no revert strings.
import type { Diff } from "@guardian402/shared";
import type { SimResult } from "./sim/types.ts";

export function toDiff(sim: SimResult): Diff {
  const vault = sim.vault.toLowerCase();
  return {
    tokenDeltas: sim.tokenDeltas
      .filter((t) => t.delta !== 0n)
      .map((t) => ({ token: t.token, symbol: t.symbol, decimals: t.decimals, delta: t.delta.toString() })),
    nativeDelta: sim.nativeDelta.toString(),
    approvals: sim.approvals
      .filter((a) => a.owner.toLowerCase() === vault)
      .map((a) => ({
        token: a.token,
        spender: a.spender,
        amount: a.amount.toString(),
        unlimited: a.unlimited,
      })),
    transfers: sim.transfers.map((t) => ({
      token: t.token,
      from: t.from,
      to: t.to,
      amount: t.amount.toString(),
    })),
  };
}
