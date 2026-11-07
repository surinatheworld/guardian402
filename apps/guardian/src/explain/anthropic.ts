// LlmClient on the Claude Messages API (official SDK), with structured JSON output.
import Anthropic from "@anthropic-ai/sdk";
import { LLM_OUTPUT_JSON_SCHEMA, type LlmClient } from "./llm.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function anthropicClient(opts: { apiKey: string; model?: string }): LlmClient {
  // No retries: the explainer has a 1.5 s budget and falls back to the template instead.
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  return {
    async complete({ system, user, signal }) {
      const res = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          // Lowest effort: a short rewrite of facts already computed. Sampling parameters are not accepted by
          // current models, so low effort replaces the "low temperature" of the spec (§16).
          output_config: { effort: "low", format: { type: "json_schema", schema: LLM_OUTPUT_JSON_SCHEMA } },
          system,
          messages: [{ role: "user", content: user }],
        },
        { signal },
      );
      if (res.stop_reason === "refusal") throw new Error("refusal");
      const text = res.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new Error("no text block");
      return text.text;
    },
  };
}
