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
  missingDiacritics,
  TemplateExplainer,
  type LlmClient,
} from "../src/explain/index.ts";
import { DEFAULT_GEMINI_MODEL, geminiClient } from "../src/explain/gemini.ts";
import { openAiCompatClient } from "../src/explain/openai-compat.ts";
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

  it("shows a lookalike and the address it imitates in full, so they cannot read the same", async () => {
    const e = await template.explain(input("poisoned-approval"));
    expect(e.en).toMatch(
      /Lookalike address 0x[0-9a-fA-F]{40} imitates MockRouter \(DEMO\) \(0x[0-9a-fA-F]{40}\)/,
    );
    expect(e.vi).toMatch(
      /Địa chỉ nhái 0x[0-9a-fA-F]{40} trông giống MockRouter \(DEMO\) \(0x[0-9a-fA-F]{40}\)/,
    );
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

describe("buildUserPrompt amounts", () => {
  it("gives the model whole-token amounts, never raw units", () => {
    const swap = JSON.parse(buildUserPrompt(input("medium-slippage")));
    expect(swap.diff.tokenDeltas.map((t: { change: string }) => t.change)).toEqual([
      "-2 USDC",
      "0.07976 mWAVAX",
    ]);
    expect(swap.findings[0].evidence).toMatchObject({ slippagePercent: 4.98 });
    expect(JSON.stringify(swap)).not.toContain("2000000");
    const poisoned = JSON.parse(buildUserPrompt(input("poisoned-approval")));
    expect(poisoned.diff.approvals[0].amount).toBe("unlimited");
    const drain = JSON.parse(buildUserPrompt(input("drain-to-attacker")));
    expect(
      drain.findings.find((f: { ruleId: string }) => f.ruleId === "DRAIN_PATTERN").evidence,
    ).toMatchObject({
      outflow: "50 USDC",
      balanceBefore: "50 USDC",
    });
  });
});

describe("openAiCompatClient", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const req = { system: "sys", user: "usr", signal: new AbortController().signal };

  it("posts a Chat Completions request in JSON mode with a bearer key, and unwraps a json fence", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fenced = "```json\n" + JSON.stringify({ vi: "a", en: "b" }) + "\n```";
    const client = openAiCompatClient({
      apiKey: "k-test",
      baseUrl: "https://api.example/v1/",
      model: "m1",
      fetch: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return ok({ choices: [{ message: { content: fenced }, finish_reason: "stop" }] });
      },
    });
    expect(await client.complete(req)).toBe(JSON.stringify({ vi: "a", en: "b" }));
    expect(seen?.url).toBe("https://api.example/v1/chat/completions");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer k-test");
    const body = JSON.parse(String(seen?.init.body));
    expect(body).toMatchObject({ model: "m1", response_format: { type: "json_object" } });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("throws on HTTP errors, refusals and cut-off answers", async () => {
    const run = (res: Response) =>
      openAiCompatClient({
        apiKey: "k",
        baseUrl: "https://x/v1",
        model: "m",
        fetch: async () => res,
      }).complete(req);
    await expect(run(ok({}, 429))).rejects.toThrow("HTTP 429");
    await expect(
      run(ok({ choices: [{ message: { refusal: "no" }, finish_reason: "stop" }] })),
    ).rejects.toThrow("refusal");
    await expect(
      run(ok({ choices: [{ message: { content: "{" }, finish_reason: "length" }] })),
    ).rejects.toThrow("finish length");
  });
});

describe("Vietnamese diacritics", () => {
  it("unaccented Vietnamese falls back to the template", async () => {
    expect(missingDiacritics("Muc do rui ro: THAP. Giao dich nay phe duyet 2 USDC.")).toBe(true);
    expect(missingDiacritics("Mức độ rủi ro: THẤP.")).toBe(false);
    const reasons: string[] = [];
    const e = await new LlmExplainer(fake('{"vi":"Muc do rui ro: THAP.","en":"Risk level: LOW."}'), {
      onFallback: (r) => reasons.push(r),
    }).explain(input("normal-swap"));
    expect(e.source).toBe("template");
    expect(reasons).toEqual(["no-diacritics"]);
  });
});

describe("createExplainer", () => {
  it("LLM_PROVIDER=none → templates; anthropic and gemini need a key; anything else is refused", () => {
    expect(createExplainer({ LLM_PROVIDER: "none" })).toBeInstanceOf(TemplateExplainer);
    expect(createExplainer({})).toBeInstanceOf(TemplateExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "anthropic" })).toThrow(/LLM_API_KEY/);
    expect(createExplainer({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "test" })).toBeInstanceOf(LlmExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "gemini" })).toThrow(/LLM_API_KEY/);
    expect(createExplainer({ LLM_PROVIDER: "gemini", LLM_API_KEY: "test" })).toBeInstanceOf(LlmExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "groq", LLM_API_KEY: "test" })).toThrow(/LLM_MODEL/);
    expect(createExplainer({ LLM_PROVIDER: "groq", LLM_API_KEY: "t", LLM_MODEL: "m" })).toBeInstanceOf(
      LlmExplainer,
    );
    expect(() =>
      createExplainer({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "t", LLM_MODEL: "m" }),
    ).toThrow(/LLM_BASE_URL/);
    expect(
      createExplainer({
        LLM_PROVIDER: "openai-compatible",
        LLM_API_KEY: "t",
        LLM_MODEL: "m",
        LLM_BASE_URL: "http://127.0.0.1:1/v1",
      }),
    ).toBeInstanceOf(LlmExplainer);
    expect(() => createExplainer({ LLM_PROVIDER: "other" })).toThrow(/LLM_PROVIDER/);
  });
});

describe("geminiClient", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const req = { system: "sys", user: "usr", signal: new AbortController().signal };

  it("sends the key in a header, the model in the path, and asks for JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = geminiClient({
      apiKey: "k-test",
      fetch: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return ok({
          candidates: [
            { content: { parts: [{ text: '{"vi":"a",' }, { text: '"en":"b"}' }] }, finishReason: "STOP" },
          ],
        });
      },
    });
    expect(await client.complete(req)).toBe('{"vi":"a","en":"b"}');
    expect(seen?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    expect(seen?.url).not.toContain("k-test");
    expect((seen?.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-test");
    const body = JSON.parse(String(seen?.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("usr");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(seen?.init.signal).toBe(req.signal);
  });

  it("throws on HTTP errors, blocked prompts and unfinished answers (the explainer then uses the template)", async () => {
    const run = (res: Response) => geminiClient({ apiKey: "k", fetch: async () => res }).complete(req);
    await expect(run(ok({ error: { message: "bad key k" } }, 400))).rejects.toThrow("gemini HTTP 400");
    await expect(run(ok({ promptFeedback: { blockReason: "SAFETY" } }))).rejects.toThrow("refusal");
    await expect(
      run(ok({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] })),
    ).rejects.toThrow("finish MAX_TOKENS");
    await expect(run(ok({ candidates: [] }))).rejects.toThrow("no candidate");
  });

  it("a Gemini failure falls back to the template", async () => {
    const reasons: string[] = [];
    const explainer = new LlmExplainer(geminiClient({ apiKey: "k", fetch: async () => ok({}, 503) }), {
      onFallback: (r) => reasons.push(r),
    });
    const out = await explainer.explain(input("drain-to-attacker"));
    expect(out.source).toBe("template");
    expect(reasons).toEqual(["error"]);
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
