// The nine rules of docs/SPEC.md §8. Each is a pure function (sim, ctx, cfg) => Finding[]: no chain, no network.
// Evidence holds only addresses, numbers and rule facts, never untrusted text (revert strings stay out).
import { decodeFunctionData, getAddress, type Address } from "viem";
import { mockRouterAbi, type RuleId } from "@guardian402/shared";
import type { SimResult } from "../sim/types.ts";
import type { Context, Finding, RuleConfig } from "./types.ts";
import {
  addressBook,
  decodeErc20Call,
  indexed,
  lc,
  recipientSet,
  selectorOf,
  targetSet,
  trackedPolicy,
  ZERO_ADDRESS,
} from "./util.ts";

export type Rule = (sim: SimResult, ctx: Context, cfg: RuleConfig) => Finding[];

const finding = (
  ruleId: RuleId,
  severity: Finding["severity"],
  title: string,
  evidence: Finding["evidence"] = {},
): Finding => ({ ruleId, severity, title, evidence });

/** Approvals granted by the vault: from the simulation logs, plus approve() calldata when the simulation failed. */
function vaultApprovals(sim: SimResult, ctx: Context) {
  const out = sim.approvals
    .filter((a) => lc(a.owner) === lc(ctx.vault))
    .map((a) => ({ token: a.token, spender: a.spender, amount: a.amount }));
  if (!sim.success) {
    for (const { call } of indexed(sim.calls)) {
      const d = decodeErc20Call(call.data);
      if (d?.kind !== "approve") continue;
      if (!out.some((a) => lc(a.token) === lc(call.target) && lc(a.spender) === lc(d.to))) {
        out.push({ token: call.target, spender: d.to, amount: d.amount });
      }
    }
  }
  return out;
}

/** Token transfers out of the vault: from the logs, plus transfer() calldata when the simulation failed. */
function vaultTransfers(sim: SimResult, ctx: Context) {
  const out = sim.transfers
    .filter((t) => lc(t.from) === lc(ctx.vault) && t.amount > 0n)
    .map((t) => ({ token: t.token, to: t.to, amount: t.amount }));
  if (!sim.success) {
    for (const { call } of indexed(sim.calls)) {
      const d = decodeErc20Call(call.data);
      if (d?.kind === "transfer" && d.amount > 0n)
        out.push({ token: call.target, to: d.to, amount: d.amount });
    }
  }
  return out;
}

// ------------------------------------------------------------------ SIMULATION_FAILED

export const simulationFailed: Rule = (sim) => {
  if (sim.success && !sim.timedOut) return [];
  return [
    finding(
      "SIMULATION_FAILED",
      "HIGH",
      sim.timedOut ? "Simulation timed out" : "A call reverted in simulation",
      {
        timedOut: sim.timedOut,
        ...(sim.failedCallIndex === undefined ? {} : { failedCallIndex: sim.failedCallIndex }),
      },
    ),
  ];
};

// ------------------------------------------------------------------ POLICY_PRECHECK

/** The vault's static checks (SPEC §4.3 steps 1–2) plus the remaining daily cap, from the policy snapshot. */
export const policyPrecheck: Rule = (sim, ctx) => {
  const p = ctx.policy;
  const out: Finding[] = [];
  const recipients = recipientSet(ctx);
  const targets = targetSet(ctx);
  const selectorAllowed = (target: Address, sel: string) =>
    p.targets.some((t) => lc(t.target) === lc(target) && t.selectors.some((s) => lc(s) === sel));
  const fail = (reason: string, evidence: Finding["evidence"]) =>
    out.push(
      finding("POLICY_PRECHECK", "HIGH", `Vault policy would reject the batch: ${reason}`, {
        reason,
        ...evidence,
      }),
    );

  if (p.paused) fail("paused", {});
  if (lc(p.agent) === lc(ZERO_ADDRESS)) fail("no-agent", {});
  if (sim.calls.length === 0 || sim.calls.length > 8) fail("bad-batch", { calls: sim.calls.length });

  for (const { call, index } of indexed(sim.calls)) {
    const target = lc(call.target);
    if (target === lc(ctx.vault) || target === lc(ZERO_ADDRESS)) {
      fail("target-not-allowed", { callIndex: index, target: call.target });
      continue;
    }
    const tracked = trackedPolicy(ctx, call.target);
    if (tracked) {
      const d = decodeErc20Call(call.data);
      if (!d) {
        fail("selector-not-allowed", {
          callIndex: index,
          target: call.target,
          selector: selectorOf(call.data) ?? "0x",
        });
      } else if (d.kind === "transfer") {
        if (!recipients.has(lc(d.to))) fail("recipient-not-allowed", { callIndex: index, recipient: d.to });
      } else if (d.amount > 0n) {
        if (!recipients.has(lc(d.to))) fail("spender-not-allowed", { callIndex: index, spender: d.to });
        if (d.amount > tracked.maxApproval) {
          fail("approval-too-large", {
            callIndex: index,
            token: call.target,
            amount: d.amount.toString(),
            maxApproval: tracked.maxApproval.toString(),
          });
        }
      }
    } else if (call.data.length > 2) {
      const sel = selectorOf(call.data);
      if (!targets.has(target)) fail("target-not-allowed", { callIndex: index, target: call.target });
      else if (!sel || !selectorAllowed(call.target, sel)) {
        fail("selector-not-allowed", { callIndex: index, target: call.target, selector: sel ?? "0x" });
      }
    } else if (!recipients.has(target)) {
      fail("recipient-not-allowed", { callIndex: index, recipient: call.target });
    }
    if (call.value > 0n && !targets.has(target) && !recipients.has(target)) {
      fail("value-target-not-allowed", { callIndex: index, target: call.target });
    }
  }

  // Remaining daily cap on the simulated outflow (SPEC §4.3 step 6).
  for (const t of p.tokens) {
    const delta = sim.tokenDeltas.find((d) => lc(d.token) === lc(t.token));
    const outflow = delta && delta.delta < 0n ? -delta.delta : 0n;
    const remaining = t.dailyCap > t.spentToday ? t.dailyCap - t.spentToday : 0n;
    if (outflow > remaining) {
      fail("daily-cap-exceeded", {
        token: t.token,
        outflow: outflow.toString(),
        remaining: remaining.toString(),
      });
    }
  }
  const nativeOut = sim.nativeDelta < 0n ? -sim.nativeDelta : 0n;
  const nativeRemaining = p.nativeDailyCap > p.nativeSpentToday ? p.nativeDailyCap - p.nativeSpentToday : 0n;
  if (nativeOut > nativeRemaining) {
    fail("daily-cap-exceeded", {
      token: ZERO_ADDRESS,
      outflow: nativeOut.toString(),
      remaining: nativeRemaining.toString(),
    });
  }

  // Per-batch cap and running budget on the same simulated outflow (SPEC §4.9). 0 = no limit.
  for (const l of p.limits ?? []) {
    const isNative = lc(l.token) === lc(ZERO_ADDRESS);
    const delta = isNative
      ? sim.nativeDelta
      : sim.tokenDeltas.find((d) => lc(d.token) === lc(l.token))?.delta;
    const outflow = delta !== undefined && delta < 0n ? -delta : 0n;
    if (outflow === 0n) continue;
    if (l.maxPerTx > 0n && outflow > l.maxPerTx) {
      fail("tx-cap-exceeded", {
        token: l.token,
        outflow: outflow.toString(),
        maxPerTx: l.maxPerTx.toString(),
      });
    }
    if (l.budget > 0n) {
      const left = l.budget > l.spentSinceReset ? l.budget - l.spentSinceReset : 0n;
      if (outflow > left) {
        fail("budget-exceeded", { token: l.token, outflow: outflow.toString(), remaining: left.toString() });
      }
    }
  }
  return out;
};

// ------------------------------------------------------------------ UNLIMITED_APPROVAL

export const unlimitedApproval: Rule = (sim, ctx, cfg) => {
  const out: Finding[] = [];
  const recipients = recipientSet(ctx);
  for (const a of vaultApprovals(sim, ctx)) {
    if (a.amount === 0n) continue; // revocation
    const tracked = trackedPolicy(ctx, a.token);
    const reasons: string[] = [];
    if (a.amount >= cfg.unlimitedApproval.threshold) reasons.push("unlimited");
    if (tracked && a.amount > tracked.maxApproval) reasons.push("above-max-approval");
    if (!recipients.has(lc(a.spender))) reasons.push("spender-not-allowlisted");
    if (reasons.length === 0) continue;
    out.push(
      finding("UNLIMITED_APPROVAL", "HIGH", "Risky token approval", {
        token: a.token,
        spender: a.spender,
        amount: a.amount.toString(),
        unlimited: a.amount >= cfg.unlimitedApproval.threshold,
        reasons: reasons.join(","),
      }),
    );
  }
  for (const a of sim.approvalsForAll) {
    if (lc(a.owner) !== lc(ctx.vault) || !a.approved) continue;
    out.push(
      finding("UNLIMITED_APPROVAL", "HIGH", "Approval for all tokens of a collection", {
        token: a.token,
        spender: a.operator,
        approvalForAll: true,
      }),
    );
  }
  return out;
};

// ------------------------------------------------------------------ UNKNOWN_CONTRACT

export const unknownContract: Rule = (sim, ctx, cfg) => {
  const contracts = new Set(ctx.contracts.map(lc));
  const known = new Set(Object.keys(ctx.knownContracts).map(lc));
  const approved = new Set(
    vaultApprovals(sim, ctx)
      .filter((a) => a.amount > 0n)
      .map((a) => lc(a.spender)),
  );
  const paid = new Set([
    ...sim.calls.filter((c) => c.value > 0n).map((c) => lc(c.target)),
    ...vaultTransfers(sim, ctx).map((t) => lc(t.to)),
  ]);
  const seen = new Set<string>();
  // Revoking an approval (approve to 0) only lowers exposure, so its spender is not a candidate (eval b11).
  const candidates = [
    ...sim.calls.map((c) => c.target),
    ...vaultApprovals(sim, ctx)
      .filter((a) => a.amount > 0n)
      .map((a) => a.spender),
  ];
  const out: Finding[] = [];
  for (const addr of candidates) {
    const key = lc(addr);
    if (seen.has(key) || known.has(key) || !contracts.has(key) || key === lc(ctx.vault)) continue;
    seen.add(key);
    const exposed = approved.has(key) || paid.has(key);
    const info = cfg.explorerLookup.enabled ? ctx.explorer?.[key] : undefined;
    // With the explorer lookup on, an unknown contract whose source is not verified on the explorer, or that
    // was created only days ago, is HIGH even when the vault does not pay or approve it.
    const suspicious =
      info !== undefined &&
      (!info.verified || (info.ageDays !== undefined && info.ageDays < cfg.explorerLookup.newContractDays));
    out.push(
      finding(
        "UNKNOWN_CONTRACT",
        exposed || suspicious ? "HIGH" : "MEDIUM",
        suspicious
          ? "Unverified or new contract not in the known-contracts registry"
          : "Contract not in the known-contracts registry",
        {
          address: getAddress(addr),
          receivesFundsOrApproval: exposed,
          ...(info ? { verified: info.verified } : {}),
          ...(info?.ageDays === undefined ? {} : { ageDays: info.ageDays }),
        },
      ),
    );
  }
  return out;
};

// ------------------------------------------------------------------ ADDRESS_POISONING

export const addressPoisoning: Rule = (sim, ctx, cfg) => {
  const book = addressBook(ctx);
  const prefix = ctx.demoMode ? cfg.addressPoisoning.demoPrefix : cfg.addressPoisoning.prefix;
  const suffix = ctx.demoMode ? cfg.addressPoisoning.demoSuffix : cfg.addressPoisoning.suffix;
  const body = (a: string) => lc(a).slice(2);
  const counterparties: { address: Address; role: string }[] = [
    ...vaultTransfers(sim, ctx).map((t) => ({ address: t.to, role: "recipient" })),
    ...vaultApprovals(sim, ctx)
      .filter((a) => a.amount > 0n)
      .map((a) => ({ address: a.spender, role: "spender" })),
    ...sim.calls.filter((c) => c.value > 0n).map((c) => ({ address: c.target, role: "recipient" })),
  ];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const { address, role } of counterparties) {
    const a = body(address);
    if (book.has(lc(address)) || seen.has(a)) continue;
    const twin = [...book].find((b) => {
      const k = body(b);
      return k !== a && k.slice(0, prefix) === a.slice(0, prefix) && k.slice(-suffix) === a.slice(-suffix);
    });
    if (!twin) continue;
    seen.add(a);
    out.push(
      finding("ADDRESS_POISONING", "HIGH", "Lookalike of a trusted address", {
        address: getAddress(address),
        role,
        looksLike: getAddress(twin),
        prefix,
        suffix,
      }),
    );
  }
  return out;
};

// ------------------------------------------------------------------ DRAIN_PATTERN

// A payment the owner already allowed is not a drain: when every unit that left the vault went to a recipient on
// the vault's allowlist, the size of the payment is bounded by the vault's own caps (per transaction, daily,
// budget), not by this rule. Without this, paying 1 USDC to the treasury from a vault holding 2 USDC was HIGH.
// A drain to anyone else, or through a router or an approval, still fires.
export const drainPattern: Rule = (sim, ctx, cfg) => {
  const pct = BigInt(cfg.drainPattern.percent);
  const allowed = new Set(ctx.policy.recipients.map(lc));
  const transfers = vaultTransfers(sim, ctx);
  const paidToAllowed = (token: string, outflow: bigint) => {
    const mine = transfers.filter((t) => lc(t.token) === lc(token));
    if (mine.length === 0 || !mine.every((t) => allowed.has(lc(t.to)))) return false;
    return mine.reduce((sum, t) => sum + t.amount, 0n) >= outflow;
  };
  const out: Finding[] = [];
  for (const t of ctx.policy.tokens) {
    const d = sim.tokenDeltas.find((x) => lc(x.token) === lc(t.token));
    if (!d || d.delta >= 0n || d.before === 0n) continue;
    const outflow = -d.delta;
    if (outflow * 100n >= d.before * pct && !paidToAllowed(t.token, outflow)) {
      out.push(
        finding("DRAIN_PATTERN", "HIGH", "Batch moves most of the vault balance", {
          token: t.token,
          outflow: outflow.toString(),
          balanceBefore: d.before.toString(),
          percent: Number((outflow * 10000n) / d.before) / 100,
        }),
      );
    }
  }
  // The simulator tops the vault up with a gas buffer, so the real AVAX balance comes from the policy snapshot.
  const nativeOut = sim.nativeDelta < 0n ? -sim.nativeDelta : 0n;
  const nativeBefore = ctx.policy.nativeBalance;
  const valueCalls = sim.calls.filter((c) => c.value > 0n);
  const nativeToAllowed =
    valueCalls.length > 0 &&
    valueCalls.every((c) => allowed.has(lc(c.target)) && c.data === "0x") &&
    valueCalls.reduce((sum, c) => sum + c.value, 0n) >= nativeOut;
  if (nativeOut > 0n && (nativeBefore === 0n || nativeOut * 100n >= nativeBefore * pct) && !nativeToAllowed) {
    out.push(
      finding("DRAIN_PATTERN", "HIGH", "Batch moves most of the vault's AVAX", {
        token: ZERO_ADDRESS,
        outflow: nativeOut.toString(),
        balanceBefore: nativeBefore.toString(),
        percent: nativeBefore === 0n ? 100 : Number((nativeOut * 10000n) / nativeBefore) / 100,
      }),
    );
  }
  return out;
};

// ------------------------------------------------------------------ ABNORMAL_SLIPPAGE

/** Swaps through a known router, compared with the MockOracle reference price. */
export const abnormalSlippage: Rule = (sim, ctx, cfg) => {
  const o = ctx.oracle;
  if (!o || o.price === 0n) return [];
  const out: Finding[] = [];
  for (const { call, index } of indexed(sim.calls)) {
    if (ctx.knownContracts[lc(call.target)]?.kind !== "router") continue;
    let args: readonly [Address, Address, bigint, bigint, number, Address];
    try {
      const decoded = decodeFunctionData({ abi: mockRouterAbi, data: call.data });
      if (decoded.functionName !== "swapExactIn") continue;
      args = decoded.args as typeof args;
    } catch {
      continue;
    }
    const [tokenIn, tokenOut, amountIn, minOut, poolId, to] = args;
    const unit = 10n ** BigInt(o.baseDecimals);
    let expected: bigint;
    if (lc(tokenIn) === lc(o.quote) && lc(tokenOut) === lc(o.base)) expected = (amountIn * unit) / o.price;
    else if (lc(tokenIn) === lc(o.base) && lc(tokenOut) === lc(o.quote))
      expected = (amountIn * o.price) / unit;
    else continue;
    if (expected === 0n) continue;
    // Only this call's output: two swaps through the same router to the same recipient must not add up.
    const realized = sim.transfers
      .filter((t) => t.callIndex === undefined || t.callIndex === index)
      .filter((t) => lc(t.token) === lc(tokenOut) && lc(t.from) === lc(call.target) && lc(t.to) === lc(to))
      .reduce((s, t) => s + t.amount, 0n);
    if (!sim.success && realized === 0n) continue; // SIMULATION_FAILED covers it
    const bps = realized >= expected ? 0n : ((expected - realized) * 10000n) / expected;
    const severity =
      bps >= BigInt(cfg.abnormalSlippage.highBps)
        ? "HIGH"
        : bps >= BigInt(cfg.abnormalSlippage.mediumBps)
          ? "MEDIUM"
          : null;
    if (!severity) continue;
    out.push(
      finding("ABNORMAL_SLIPPAGE", severity, "Swap returns much less than the reference price", {
        callIndex: index,
        router: call.target,
        poolId: Number(poolId),
        amountIn: amountIn.toString(),
        expectedOut: expected.toString(),
        realizedOut: realized.toString(),
        minOut: minOut.toString(),
        slippageBps: Number(bps),
      }),
    );
  }
  return out;
};

// ------------------------------------------------------------------ UNPROTECTED_SWAP

/**
 * A swap through a known router whose `minOut` sits far below the simulated output. The simulation runs on a
 * fork; the vault executes later on Fuji. With `minOut = 0` (or close to it), a pool that moves in between, or a
 * sandwich around the agent's transaction, costs the vault whatever it moved, and the verdict no longer says
 * anything about the real outcome. MEDIUM: nothing bad happened in the simulation, but the protection is
 * missing; a vault that accepts only LOW verdicts refuses it.
 */
export const unprotectedSwap: Rule = (sim, ctx, cfg) => {
  if (!sim.success) return []; // no simulated output to compare with; SIMULATION_FAILED covers a revert
  const out: Finding[] = [];
  for (const { call, index } of indexed(sim.calls)) {
    if (ctx.knownContracts[lc(call.target)]?.kind !== "router") continue;
    let args: readonly [Address, Address, bigint, bigint, number, Address];
    try {
      const decoded = decodeFunctionData({ abi: mockRouterAbi, data: call.data });
      if (decoded.functionName !== "swapExactIn") continue;
      args = decoded.args as typeof args;
    } catch {
      continue;
    }
    const [, tokenOut, , minOut, , to] = args;
    const simulatedOut = sim.transfers
      .filter((t) => t.callIndex === undefined || t.callIndex === index)
      .filter((t) => lc(t.token) === lc(tokenOut) && lc(t.from) === lc(call.target) && lc(t.to) === lc(to))
      .reduce((s, t) => s + t.amount, 0n);
    if (simulatedOut === 0n) continue;
    const gapBps = minOut >= simulatedOut ? 0n : ((simulatedOut - minOut) * 10_000n) / simulatedOut;
    if (gapBps <= BigInt(cfg.unprotectedSwap.maxGapBps)) continue;
    out.push(
      finding("UNPROTECTED_SWAP", "MEDIUM", "Swap accepts far less than the simulated output", {
        callIndex: index,
        router: call.target,
        token: tokenOut,
        minOut: minOut.toString(),
        simulatedOut: simulatedOut.toString(),
        gapBps: Number(gapBps),
        maxGapBps: cfg.unprotectedSwap.maxGapBps,
      }),
    );
  }
  return out;
};

// ------------------------------------------------------------------ RECIPIENT_NOT_ALLOWLISTED

export const recipientNotAllowlisted: Rule = (sim, ctx) => {
  const recipients = recipientSet(ctx);
  const targets = targetSet(ctx);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const t of vaultTransfers(sim, ctx)) {
    const key = `${lc(t.token)}:${lc(t.to)}`;
    if (recipients.has(lc(t.to)) || seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding(
        "RECIPIENT_NOT_ALLOWLISTED",
        "HIGH",
        "Funds leave the vault to an address outside the allowlist",
        {
          token: t.token,
          recipient: t.to,
          amount: t.amount.toString(),
        },
      ),
    );
  }
  // A swap through a known router sends its output to `to`; that output belongs to the vault (P11 review F1).
  for (const { call, index } of indexed(sim.calls)) {
    if (ctx.knownContracts[lc(call.target)]?.kind !== "router") continue;
    let to: Address;
    try {
      const decoded = decodeFunctionData({ abi: mockRouterAbi, data: call.data });
      if (decoded.functionName !== "swapExactIn") continue;
      to = decoded.args[5];
    } catch {
      continue;
    }
    if (lc(to) === lc(ctx.vault) || recipients.has(lc(to))) continue;
    out.push(
      finding("RECIPIENT_NOT_ALLOWLISTED", "HIGH", "Swap output goes to an address outside the allowlist", {
        recipient: to,
        router: call.target,
        callIndex: index,
        via: "swap-output",
      }),
    );
  }
  for (const { call, index } of indexed(sim.calls)) {
    if (call.value === 0n || recipients.has(lc(call.target)) || targets.has(lc(call.target))) continue;
    out.push(
      finding(
        "RECIPIENT_NOT_ALLOWLISTED",
        "HIGH",
        "AVAX leaves the vault to an address outside the allowlist",
        {
          token: ZERO_ADDRESS,
          recipient: call.target,
          amount: call.value.toString(),
          callIndex: index,
        },
      ),
    );
  }
  return out;
};

/** In report order. */
export const RULES: Record<RuleId, Rule> = {
  SIMULATION_FAILED: simulationFailed,
  POLICY_PRECHECK: policyPrecheck,
  UNLIMITED_APPROVAL: unlimitedApproval,
  UNKNOWN_CONTRACT: unknownContract,
  ADDRESS_POISONING: addressPoisoning,
  DRAIN_PATTERN: drainPattern,
  ABNORMAL_SLIPPAGE: abnormalSlippage,
  RECIPIENT_NOT_ALLOWLISTED: recipientNotAllowlisted,
  UNPROTECTED_SWAP: unprotectedSwap,
};
