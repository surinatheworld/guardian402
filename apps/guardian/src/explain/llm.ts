// LLM explanations (docs/SPEC.md §9). The model only rewrites what the simulation and the rules already found,
// in plain words; it never sees calldata, revert strings or agent text, and its output can never change the
// risk. Any error, timeout, invalid JSON or wording that contradicts the risk falls back to the template.
import { z } from "zod";
import type { Explanation, Finding, RiskLevel } from "@guardian402/shared";
import { amount, clip } from "./format.ts";
import { TemplateExplainer } from "./template.ts";
import { MAX_EXPLANATION_CHARS, type ExplainInput, type Explainer } from "./types.ts";

/** One completion: returns the model's raw text. `signal` aborts it when the time budget is spent. */
export type LlmClient = {
  complete(req: { system: string; user: string; signal: AbortSignal }): Promise<string>;
};

export const llmOutputSchema = z
  .object({
    vi: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    en: z.string().min(1).max(MAX_EXPLANATION_CHARS),
  })
  .strict();

/** JSON schema handed to the provider's structured-output mode (mirrors llmOutputSchema). */
export const LLM_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: { vi: { type: "string" }, en: { type: "string" } },
  required: ["vi", "en"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = [
  "You explain the result of a blockchain transaction security check to the owner of an AI agent's wallet.",
  "You get JSON with the risk level computed by a rule engine, the rules that fired with their evidence, and the",
  "balance changes the simulation measured. Describe only what that data shows, in plain words: what leaves or",
  "enters the wallet, what is approved, and why the rules flagged it.",
  "The risk level is final: state it, and never change, soften or contradict it.",
  "No investment advice, no price predictions, no instructions to the user.",
  `Reply with JSON {"vi": "...", "en": "..."}: Vietnamese and English, plain text, at most ${MAX_EXPLANATION_CHARS} characters each.`,
  'Write "vi" in standard Vietnamese with full diacritics (tiếng Việt có dấu), never in unaccented ASCII.',
  "Copy amounts exactly as given; never convert or recompute them.",
].join(" ");

const CONTRADICTIONS: Record<RiskLevel, RegExp> = {
  // A LOW verdict must not sound alarming; a HIGH one must not sound safe; MEDIUM must not claim either end.
  LOW: /nguy hiểm|rủi ro cao|dangerous|high risk/i,
  MEDIUM: /an toàn|rủi ro thấp|nguy hiểm|rủi ro cao|\bsafe\b|low risk|dangerous|high risk/i,
  HIGH: /an toàn|rủi ro thấp|\bsafe\b|low risk/i,
};

export function contradictsRisk(text: string, risk: RiskLevel): boolean {
  return CONTRADICTIONS[risk].test(text);
}

/** Vietnamese without any diacritic ("Muc do rui ro") reads badly; seen with Gemini on 2026-11-09. */
export function missingDiacritics(vi: string): boolean {
  return !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(vi);
}

const NATIVE = "0x0000000000000000000000000000000000000000";
/** Evidence fields that hold raw units of the finding's `token`. */
const TOKEN_AMOUNT_KEYS = ["amount", "outflow", "remaining", "balanceBefore", "maxApproval"];
/** Slippage evidence holds raw amounts of two tokens it does not name; the diff already has them in tokens. */
const RAW_SLIPPAGE_KEYS = ["amountIn", "expectedOut", "realizedOut", "minOut", "simulatedOut"];
/** "Unlimited" approvals (2^256 - 1 or close) would print as a 70-digit number. */
const UNLIMITED = 2n ** 128n;

/**
 * Raw units → "2 USDC" before the model sees them: given "2000000" and decimals 6, models sometimes wrote
 * "2,000,000 USDC" (seen with Gemini on 2026-11-09). The model gets numbers it can copy, not compute.
 */
function readable(input: ExplainInput, token: string, raw: string): string {
  try {
    const v = BigInt(raw);
    if (v >= UNLIMITED || -v >= UNLIMITED) return "unlimited";
  } catch {
    return raw;
  }
  return amount(input, token, raw, "en");
}

function readableEvidence(input: ExplainInput, evidence: Finding["evidence"]): Finding["evidence"] {
  const out: Finding["evidence"] = {};
  const token = typeof evidence.token === "string" ? evidence.token : undefined;
  for (const [k, v] of Object.entries(evidence)) {
    if (RAW_SLIPPAGE_KEYS.includes(k)) continue;
    if (k === "slippageBps" && typeof v === "number") out.slippagePercent = v / 100;
    else if (k === "gapBps" && typeof v === "number") out.minOutBelowSimulationPercent = v / 100;
    else if (k === "maxGapBps" && typeof v === "number") out.allowedGapPercent = v / 100;
    else if (token && TOKEN_AMOUNT_KEYS.includes(k) && typeof v === "string")
      out[k] = readable(input, token, v);
    else out[k] = v;
  }
  return out;
}

/** The model's input: only the normalized diff, findings and trusted labels, with amounts in whole tokens. */
export function buildUserPrompt(input: ExplainInput): string {
  const d = input.diff;
  return JSON.stringify({
    risk: input.risk,
    findings: input.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      evidence: readableEvidence(input, f.evidence),
    })),
    diff: {
      tokenDeltas: d.tokenDeltas.map((t) => ({ token: t.token, change: readable(input, t.token, t.delta) })),
      nativeChange: readable(input, NATIVE, d.nativeDelta),
      approvals: d.approvals.map((a) => ({
        token: a.token,
        spender: a.spender,
        amount: a.unlimited ? "unlimited" : readable(input, a.token, a.amount),
      })),
      transfers: d.transfers.map((t) => ({
        token: t.token,
        from: t.from,
        to: t.to,
        amount: readable(input, t.token, t.amount),
      })),
    },
    names: input.names,
  });
}

export type LlmExplainerOptions = {
  timeoutMs?: number;
  fallback?: Explainer;
  onFallback?: (reason: string) => void;
};

export class LlmExplainer implements Explainer {
  readonly #client: LlmClient;
  readonly #timeoutMs: number;
  readonly #fallback: Explainer;
  readonly #onFallback: (reason: string) => void;

  constructor(client: LlmClient, opts: LlmExplainerOptions = {}) {
    this.#client = client;
    this.#timeoutMs = opts.timeoutMs ?? 1500;
    this.#fallback = opts.fallback ?? new TemplateExplainer();
    this.#onFallback = opts.onFallback ?? (() => {});
  }

  async explain(input: ExplainInput): Promise<Explanation> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, this.#timeoutMs);
    });
    try {
      const raw = await Promise.race([
        this.#client.complete({
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(input),
          signal: controller.signal,
        }),
        timeout,
      ]);
      const parsed = llmOutputSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return this.#fall(input, "invalid-json");
      const vi = clip(parsed.data.vi);
      const en = clip(parsed.data.en);
      if (contradictsRisk(vi, input.risk) || contradictsRisk(en, input.risk))
        return this.#fall(input, "contradicts-risk");
      if (missingDiacritics(vi)) return this.#fall(input, "no-diacritics");
      return { vi, en, source: "llm" };
    } catch (e) {
      return this.#fall(
        input,
        e instanceof Error && e.message === "timeout"
          ? "timeout"
          : e instanceof SyntaxError
            ? "invalid-json"
            : "error",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  #fall(input: ExplainInput, reason: string): Promise<Explanation> {
    this.#onFallback(reason);
    return this.#fallback.explain(input);
  }
}
