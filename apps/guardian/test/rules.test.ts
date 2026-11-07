// Rule engine tests (docs/SPEC.md §8, P5). Fixtures are real SimResult objects captured on the fork with
// `pnpm --filter @guardian402/guardian fixtures:rules`; a few cases tweak a copy in memory (noted inline).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleId } from "@guardian402/shared";
import {
  aggregate,
  defaultRuleConfig,
  RULES,
  runRules,
  type Context,
  type Finding,
} from "../src/rules/index.ts";
import { loadRuleFixtures, type RuleFixture } from "./fixture-io.ts";

const F = loadRuleFixtures();
const fx = (name: string): RuleFixture => {
  const f = F[name];
  if (!f) throw new Error(`missing fixture ${name}: run fixtures:rules`);
  return structuredClone(f);
};
const fire = (rule: RuleId, f: RuleFixture, ctx: Context = f.ctx) =>
  RULES[rule](f.sim, ctx, defaultRuleConfig);
/** Narrows an element the fixture is known to have. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("fixture is missing an expected element");
  return v;
}
const ids = (fs: Finding[]) => [...new Set(fs.map((x) => x.ruleId))].sort();

/** ruleId → [positive fixtures, negative fixtures]. Printed as the P5 acceptance table. */
const MATRIX: Record<RuleId, [string[], string[]]> = {
  SIMULATION_FAILED: [["reverting-swap"], ["normal-swap", "bad-slippage"]],
  POLICY_PRECHECK: [
    [
      "drain-to-attacker",
      "poisoned-approval",
      "oversized-approval",
      "unknown-contract-call",
      "native-to-attacker",
      "cap-nearly-spent",
    ],
    ["normal-swap", "exact-approval", "revoke-approval", "treasury-transfer", "bad-slippage"],
  ],
  UNLIMITED_APPROVAL: [
    ["poisoned-approval", "oversized-approval", "unknown-contract-approval"],
    ["normal-swap", "exact-approval", "revoke-approval"],
  ],
  UNKNOWN_CONTRACT: [
    ["unknown-contract-call", "unknown-contract-approval"],
    ["normal-swap", "poisoned-approval", "drain-to-attacker"],
  ],
  ADDRESS_POISONING: [["poisoned-approval"], ["normal-swap", "treasury-transfer", "drain-to-attacker"]],
  DRAIN_PATTERN: [
    ["drain-to-attacker", "native-to-attacker"],
    ["normal-swap", "treasury-transfer"],
  ],
  ABNORMAL_SLIPPAGE: [
    ["bad-slippage", "medium-slippage"],
    ["normal-swap", "exact-approval"],
  ],
  RECIPIENT_NOT_ALLOWLISTED: [
    ["drain-to-attacker", "native-to-attacker"],
    ["normal-swap", "treasury-transfer"],
  ],
};

describe("every rule on captured fixtures", () => {
  for (const [rule, [pos, neg]] of Object.entries(MATRIX) as [RuleId, [string[], string[]]][]) {
    for (const name of pos)
      it(`${rule} fires on ${name}`, () => expect(fire(rule, fx(name)).length).toBeGreaterThan(0));
    for (const name of neg)
      it(`${rule} stays quiet on ${name}`, () => expect(fire(rule, fx(name))).toEqual([]));
  }

  it("prints the acceptance table", () => {
    const rows = Object.entries(MATRIX).map(
      ([r, [p, n]]) => `| ${r} | ${p.length + n.length} | ${p.length} / ${n.length} |`,
    );
    console.log(
      ["| ruleId | tests | positive / negative fixtures |", "| --- | --- | --- |", ...rows].join("\n"),
    );
  });
});

describe("rule details", () => {
  it("S1 normal swap is LOW with no findings", () => {
    const f = fx("normal-swap");
    expect(runRules(f.sim, f.ctx)).toEqual([]);
    expect(aggregate([])).toEqual({ risk: "LOW", riskCode: 0, score: 0 });
  });

  it("S4 bad slippage fires only ABNORMAL_SLIPPAGE (HIGH): it passes every static check", () => {
    const f = fx("bad-slippage");
    const out = runRules(f.sim, f.ctx);
    expect(ids(out)).toEqual(["ABNORMAL_SLIPPAGE"]);
    expect(out[0]).toMatchObject({ severity: "HIGH", evidence: { poolId: 1, slippageBps: 3000 } });
  });

  it("ABNORMAL_SLIPPAGE is MEDIUM between 2% and 10%", () => {
    const f = fx("medium-slippage");
    const [finding] = fire("ABNORMAL_SLIPPAGE", f);
    expect(finding?.severity).toBe("MEDIUM");
    expect(Number(finding?.evidence.slippageBps)).toBeGreaterThanOrEqual(200);
    expect(Number(finding?.evidence.slippageBps)).toBeLessThan(1000);
  });

  it("ABNORMAL_SLIPPAGE needs the oracle reference", () => {
    const f = fx("bad-slippage");
    const { oracle: _drop, ...ctx } = f.ctx;
    expect(fire("ABNORMAL_SLIPPAGE", f, ctx)).toEqual([]);
  });

  it("S2 drain fires DRAIN_PATTERN and RECIPIENT_NOT_ALLOWLISTED (spec §10)", () => {
    const f = fx("drain-to-attacker");
    const out = ids(runRules(f.sim, f.ctx));
    expect(out).toEqual(expect.arrayContaining(["DRAIN_PATTERN", "RECIPIENT_NOT_ALLOWLISTED"]));
    expect(fire("DRAIN_PATTERN", f)[0]?.evidence.percent).toBe(100);
  });

  it("S3 poisoned approval fires UNLIMITED_APPROVAL and ADDRESS_POISONING (spec §10)", () => {
    const f = fx("poisoned-approval");
    expect(ids(runRules(f.sim, f.ctx))).toEqual(
      expect.arrayContaining(["UNLIMITED_APPROVAL", "ADDRESS_POISONING"]),
    );
    const [p] = fire("ADDRESS_POISONING", f);
    expect(p?.evidence.looksLike).toBe(f.ctx.policy.targets[0]?.target);
    expect(fire("UNLIMITED_APPROVAL", f)[0]?.evidence.unlimited).toBe(true);
  });

  it("DRAIN_PATTERN triggers at exactly 50% and not one unit below", () => {
    const f = fx("drain-to-attacker");
    const d = must(f.sim.tokenDeltas.find((t) => t.delta < 0n));
    d.delta = -(d.before / 2n);
    expect(fire("DRAIN_PATTERN", f)).toHaveLength(1);
    d.delta = -(d.before / 2n) + 1n;
    expect(fire("DRAIN_PATTERN", f)).toEqual([]);
  });

  it("UNKNOWN_CONTRACT is MEDIUM for a plain call and HIGH when the vault approves it", () => {
    expect(fire("UNKNOWN_CONTRACT", fx("unknown-contract-call"))[0]?.severity).toBe("MEDIUM");
    expect(fire("UNKNOWN_CONTRACT", fx("unknown-contract-approval"))[0]?.severity).toBe("HIGH");
  });

  it("UNKNOWN_CONTRACT ignores addresses without code (the lookalike is an EOA)", () => {
    expect(fire("UNKNOWN_CONTRACT", fx("poisoned-approval"))).toEqual([]);
  });

  it("explorer facts appear only when the lookup flag is on", () => {
    const f = fx("unknown-contract-call");
    const key = must(f.sim.calls[0]).target.toLowerCase();
    const ctx: Context = { ...f.ctx, explorer: { [key]: { verified: false, ageDays: 2 } } };
    expect(RULES.UNKNOWN_CONTRACT(f.sim, ctx, defaultRuleConfig)[0]?.evidence.verified).toBeUndefined();
    const on = {
      ...defaultRuleConfig,
      explorerLookup: { ...defaultRuleConfig.explorerLookup, enabled: true },
    };
    expect(RULES.UNKNOWN_CONTRACT(f.sim, ctx, on)[0]?.evidence).toMatchObject({
      verified: false,
      ageDays: 2,
    });
  });

  it("ADDRESS_POISONING uses 3/3 characters in DEMO mode", () => {
    const f = fx("poisoned-approval");
    const router = must(f.ctx.policy.targets[0]).target.toLowerCase();
    // A lookalike that matches only the first 3 and last 3 characters (in memory).
    const fake = `0x${router.slice(2, 5)}0000000000000000000000000000000000${router.slice(-3)}` as const;
    must(f.sim.approvals[0]).spender = fake;
    expect(fire("ADDRESS_POISONING", f)).toEqual([]);
    expect(fire("ADDRESS_POISONING", f, { ...f.ctx, demoMode: true })).toHaveLength(1);
  });

  it("SIMULATION_FAILED on a timeout, without any revert text in the evidence", () => {
    const f = fx("normal-swap");
    f.sim.timedOut = true;
    const [finding] = fire("SIMULATION_FAILED", f);
    expect(finding?.evidence).toEqual({ timedOut: true });
    const r = fx("reverting-swap");
    expect(JSON.stringify(fire("SIMULATION_FAILED", r))).not.toContain(r.sim.revertReason ?? "\u0000");
  });

  it("POLICY_PRECHECK flags a paused vault and a revoked agent", () => {
    const f = fx("normal-swap");
    const paused = fire("POLICY_PRECHECK", f, { ...f.ctx, policy: { ...f.ctx.policy, paused: true } });
    expect(paused.map((x) => x.evidence.reason)).toEqual(["paused"]);
    const noAgent = fire("POLICY_PRECHECK", f, {
      ...f.ctx,
      policy: { ...f.ctx.policy, agent: "0x0000000000000000000000000000000000000000" },
    });
    expect(noAgent.map((x) => x.evidence.reason)).toEqual(["no-agent"]);
  });

  it("POLICY_PRECHECK checks the remaining daily cap against the simulated outflow", () => {
    expect(fire("POLICY_PRECHECK", fx("cap-nearly-spent")).map((x) => x.evidence.reason)).toEqual([
      "daily-cap-exceeded",
    ]);
  });

  it("UNLIMITED_APPROVAL flags ApprovalForAll(true) and ignores ApprovalForAll(false)", () => {
    const f = fx("normal-swap");
    const ev = {
      token: must(f.sim.calls[0]).target,
      owner: f.ctx.vault,
      operator: f.ctx.vault,
      approved: true,
    };
    f.sim.approvalsForAll = [ev];
    expect(fire("UNLIMITED_APPROVAL", f)[0]?.evidence.approvalForAll).toBe(true);
    f.sim.approvalsForAll = [{ ...ev, approved: false }];
    expect(fire("UNLIMITED_APPROVAL", f)).toEqual([]);
  });

  it("decodes approve() calldata when the simulation failed", () => {
    const f = fx("poisoned-approval");
    f.sim.success = false;
    f.sim.approvals = [];
    expect(fire("UNLIMITED_APPROVAL", f)).toHaveLength(1);
  });
});

describe("aggregate", () => {
  const f = (severity: Finding["severity"]): Finding => ({
    ruleId: "DRAIN_PATTERN",
    severity,
    title: "",
    evidence: {},
  });

  it("no findings → LOW, score 0", () =>
    expect(aggregate([])).toEqual({ risk: "LOW", riskCode: 0, score: 0 }));
  it("one MEDIUM → MEDIUM, 25", () =>
    expect(aggregate([f("MEDIUM")])).toEqual({ risk: "MEDIUM", riskCode: 1, score: 25 }));
  it("mixed severities → highest wins, weights add", () =>
    expect(aggregate([f("MEDIUM"), f("HIGH"), f("LOW")])).toEqual({ risk: "HIGH", riskCode: 2, score: 85 }));
  it("score caps at 100", () => expect(aggregate([f("HIGH"), f("HIGH"), f("MEDIUM")]).score).toBe(100));
  it("S2 fixture aggregates to HIGH 100", () => {
    const x = fx("drain-to-attacker");
    expect(aggregate(runRules(x.sim, x.ctx))).toEqual({ risk: "HIGH", riskCode: 2, score: 100 });
  });
});

describe("architecture", () => {
  it("rules never touch the chain or the network", () => {
    const dir = join(import.meta.dirname, "../src/rules");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(
        /create(Public|Wallet|Test)Client|\bfetch\(|from "\.\.\/context|from "node:(http|https|net)"/,
      );
    }
  });
});
