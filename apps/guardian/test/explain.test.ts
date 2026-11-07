// Explainer tests (docs/SPEC.md §9, P6), on the rule fixtures captured on the fork.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explanationSchema } from "@guardian402/shared";
import { explainInput } from "../src/explain-input.ts";
import {
  buildUserPrompt,
  contradictsRisk,
  createExplainer,
  LlmExplainer,
  TemplateExplainer,
  type LlmClient,
} from "../src/explain/index.ts";
import type { ExplainInput } from "../src/explain/types.ts";
import { aggregate, runRules } from "../src/rules/index.ts";
import { loadRuleFixtures } from "./fixture-io.ts";

const F = loadRuleFixtures();
function input(name: string): ExplainInput {
  const f = F[name];
  if (!f) throw new Error(`missing fixture ${name}`);
  const findings = runRules(f.sim, f.ctx);
  return explainInput(f.sim, findings, aggregate(findings).risk, f.ctx);
}
const fake = (reply: string | (() => Promise<string>)): LlmClient => ({
  complete: async () => (typeof reply === "string" ? reply : reply()),
});
const template = new TemplateExplainer();

describe("TemplateExplainer", () => {
  it("writes LOW, MEDIUM and HIGH explanations in both languages (printed for the P6 report)", async () => {
    for (const name of [
      "normal-swap",
      "medium-slippage",
      "drain-to-attacker",
      "bad-slippage",
      "poisoned-approval",
    ]) {
      const e = await template.explain(input(name));
      expect(explanationSchema.parse(e).source).toBe("template");
      console.log(`[${name}]\n  vi: ${e.vi}\n  en: ${e.en}`);
    }
  });

  it("states the risk and formats amounts with symbol and decimals", async () => {
    const low = await template.explain(input("normal-swap"));
    expect(low.vi).toMatch(/^Rủi ro THẤP\./);
    expect(low.en).toMatch(/^LOW risk\./);
    expect(low.vi).toContain("-2 USDC");
    expect(low.en).toContain("-2 USDC");
    const high = await template.explain(input("drain-to-attacker"));
    expect(high.vi).toMatch(/^Rủi ro CAO\./);
    expect(high.en).toContain("100% of the balance");
  });

  it("shortens unknown addresses and names known ones", async () => {
    const e = await template.explain(input("poisoned-approval"));
    expect(e.en).toMatch(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} is a lookalike of MockRouter \(DEMO\)/);
  });

  it("never contradicts its own risk and stays within 400 characters", async () => {
    for (const name of Object.keys(F)) {
      const i = input(name);
      const e = await template.explain(i);
      expect(e.vi.length, name).toBeLessThanOrEqual(400);
      expect(e.en.length, name).toBeLessThanOrEqual(400);
      expect(contradictsRisk(e.en, i.risk), `${name}: ${e.en}`).toBe(false);
    }
  });
});

describe("LlmExplainer with a fake LLM", () => {
  const good = JSON.stringify({
    vi: "Rủi ro CAO: toàn bộ USDC rời vault tới một địa chỉ lạ.",
    en: "HIGH risk: all USDC leaves the vault to an unknown address.",
  });

  it("uses valid JSON from the model", async () => {
    const e = await new LlmExplainer(fake(good)).explain(input("drain-to-attacker"));
    expect(e).toMatchObject({
      source: "llm",
      en: "HIGH risk: all USDC leaves the vault to an unknown address.",
    });
  });

  it("falls back to the template on invalid JSON", async () => {
    const reasons: string[] = [];
    const e = await new LlmExplainer(fake("not json"), { onFallback: (r) => reasons.push(r) }).explain(
      input("drain-to-attacker"),
    );
    expect(e.source).toBe("template");
    expect(reasons).toEqual(["invalid-json"]);
  });

  it("falls back on JSON with the wrong shape or too long", async () => {
    const extra = await new LlmExplainer(fake(JSON.stringify({ vi: "a", en: "b", risk: "LOW" }))).explain(
      input("normal-swap"),
    );
    const long = await new LlmExplainer(fake(JSON.stringify({ vi: "x".repeat(401), en: "y" }))).explain(
      input("normal-swap"),
    );
    expect([extra.source, long.source]).toEqual(["template", "template"]);
  });

  it("falls back on a timeout", async () => {
    const reasons: string[] = [];
    const slow = fake(() => new Promise((r) => setTimeout(() => r(good), 500)));
    const t0 = Date.now();
    const e = await new LlmExplainer(slow, { timeoutMs: 50, onFallback: (r) => reasons.push(r) }).explain(
      input("drain-to-attacker"),
    );
    expect(e.source).toBe("template");
    expect(reasons).toEqual(["timeout"]);
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("falls back on a provider error", async () => {
    const e = await new LlmExplainer(fake(() => Promise.reject(new Error("503")))).explain(
      input("normal-swap"),
    );
    expect(e.source).toBe("template");
  });

  it("falls back when the text contradicts the risk", async () => {
    const reasons: string[] = [];
    const calm = JSON.stringify({ vi: "Giao dịch an toàn.", en: "This transaction is safe." });
    const scary = JSON.stringify({ vi: "Giao dịch nguy hiểm!", en: "Dangerous transaction!" });
    const opts = { onFallback: (r: string) => reasons.push(r) };
    expect((await new LlmExplainer(fake(calm), opts).explain(input("drain-to-attacker"))).source).toBe(
      "template",
    );
    expect((await new LlmExplainer(fake(scary), opts).explain(input("normal-swap"))).source).toBe("template");
    expect(reasons).toEqual(["contradicts-risk", "contradicts-risk"]);
  });

  it("the model never sees calldata or revert strings", () => {
    for (const name of ["reverting-swap", "drain-to-attacker", "unknown-contract-call"]) {
      const f = F[name];
      if (!f) throw new Error(name);
      const prompt = buildUserPrompt(input(name));
      for (const call of f.sim.calls)
        if (call.data.length > 10) expect(prompt).not.toContain(call.data.slice(10));
      if (f.sim.revertReason) expect(prompt).not.toContain(f.sim.revertReason);
      if (f.sim.revertData) expect(prompt).not.toContain(f.sim.revertData);
    }
  });
});

describe("createExplainer", () => {
  it("LLM_PROVIDER=none → templates; anthropic needs a key; anything else is refused", () => {
    expect(createExplainer({ LLM_PROVIDER: "none" })).toBeInstanceOf(TemplateExplainer);
    expect(createExplainer({})).toBeInstanceOf(TemplateExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "anthropic" })).toThrow(/LLM_API_KEY/);
    expect(createExplainer({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "test" })).toBeInstanceOf(LlmExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "other" })).toThrow(/LLM_PROVIDER/);
  });
});

describe("architecture", () => {
  it("nothing in src/explain imports the signer, rule aggregation, or creates a wallet client", () => {
    const dir = join(import.meta.dirname, "../src/explain");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(
        /from "\.\.\/sign|from "@guardian402\/shared\/sign"|\/rules\/(aggregate|index)|from "\.\.\/rules"/,
      );
      expect(src, file).not.toMatch(/createWalletClient|privateKeyToAccount|signTypedData|mnemonicToAccount/);
    }
  });
});
