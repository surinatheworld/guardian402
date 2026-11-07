// Explainer (docs/SPEC.md §9). Writes text only: nothing here can sign, move funds or change a risk level.
import { anthropicClient } from "./anthropic.ts";
import { LlmExplainer } from "./llm.ts";
import { TemplateExplainer } from "./template.ts";
import type { Explainer } from "./types.ts";

export { TemplateExplainer } from "./template.ts";
export { LlmExplainer, contradictsRisk, buildUserPrompt, SYSTEM_PROMPT, type LlmClient } from "./llm.ts";
export type { Explainer, ExplainInput } from "./types.ts";

/** LLM_PROVIDER: `none` (templates only) or `anthropic`. */
export function createExplainer(env: {
  LLM_PROVIDER?: string | undefined;
  LLM_MODEL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  onFallback?: (reason: string) => void;
}): Explainer {
  const provider = (env.LLM_PROVIDER || "none").toLowerCase();
  if (provider === "none") return new TemplateExplainer();
  if (provider !== "anthropic")
    throw new Error(`LLM_PROVIDER must be "none" or "anthropic", got "${provider}"`);
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required when LLM_PROVIDER=anthropic");
  return new LlmExplainer(
    anthropicClient({ apiKey: env.LLM_API_KEY, ...(env.LLM_MODEL ? { model: env.LLM_MODEL } : {}) }),
    {
      ...(env.onFallback ? { onFallback: env.onFallback } : {}),
    },
  );
}
