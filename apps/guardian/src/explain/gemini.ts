// LlmClient on the Gemini API (REST `generateContent`, no SDK), with structured JSON output.
// Verified against the live API on 2026-11-09: `responseSchema` (OpenAPI subset, upper-case types) and no
// thinking config; the Gemini 3.x lite models reject `thinkingBudget`.
import type { LlmClient } from "./llm.ts";

/** Fast enough for the 1.5 s explainer budget (about 1.0 s measured from Vietnam). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini's schema dialect of LLM_OUTPUT_JSON_SCHEMA (no `additionalProperties`; zod still checks strictly). */
const GEMINI_OUTPUT_SCHEMA = {
  type: "OBJECT",
  properties: { vi: { type: "STRING" }, en: { type: "STRING" } },
  required: ["vi", "en"],
} as const;

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

export function geminiClient(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): LlmClient {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const doFetch = opts.fetch ?? fetch;
  return {
    async complete({ system, user, signal }) {
      const res = await doFetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        // The key goes in a header, never in the URL (it would end up in logs).
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GEMINI_OUTPUT_SCHEMA,
            maxOutputTokens: 1024,
          },
        }),
        signal,
      });
      // Only the status: error bodies are not passed on.
      if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
      const body = (await res.json()) as GenerateContentResponse;
      if (body.promptFeedback?.blockReason) throw new Error("refusal");
      const candidate = body.candidates?.[0];
      if (!candidate) throw new Error("no candidate");
      if (candidate.finishReason && candidate.finishReason !== "STOP")
        throw new Error(`finish ${candidate.finishReason}`);
      const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (!text) throw new Error("no text");
      return text;
    },
  };
}
