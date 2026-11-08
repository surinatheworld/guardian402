// LlmClient on any OpenAI-compatible Chat Completions endpoint (REST, no SDK): Groq, OpenRouter, Cerebras,
// Mistral, GitHub Models, Gemini's compatibility layer… JSON mode via `response_format: json_object`; the
// strict shape is still checked by zod in LlmExplainer.
import type { LlmClient } from "./llm.ts";

/** Providers with a known base URL. Each needs LLM_MODEL (free model lists change too often for defaults). */
export const OPENAI_COMPAT_PRESETS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  cerebras: "https://api.cerebras.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  "github-models": "https://models.github.ai/inference",
  "gemini-openai": "https://generativelanguage.googleapis.com/v1beta/openai",
};

type ChatCompletion = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
};

/** Some models wrap JSON in a ```json fence even in JSON mode. */
function unfence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return m?.[1] ?? text;
}

export function openAiCompatClient(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}): LlmClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    async complete({ system, user, signal }) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal,
      });
      // Only the status: error bodies are not passed on.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ChatCompletion;
      const choice = body.choices?.[0];
      if (!choice) throw new Error("no choice");
      if (choice.message?.refusal) throw new Error("refusal");
      if (choice.finish_reason && choice.finish_reason !== "stop")
        throw new Error(`finish ${choice.finish_reason}`);
      const text = choice.message?.content;
      if (!text) throw new Error("no text");
      return unfence(text);
    },
  };
}
