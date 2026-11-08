// Explainer (docs/SPEC.md §9). Writes text only: nothing here can sign, move funds or change a risk level.
import { anthropicClient } from "./anthropic.ts";
import { geminiClient } from "./gemini.ts";
import { OPENAI_COMPAT_PRESETS, openAiCompatClient } from "./openai-compat.ts";
import { LlmExplainer } from "./llm.ts";
import { TemplateExplainer } from "./template.ts";
import type { Explainer } from "./types.ts";

export { TemplateExplainer } from "./template.ts";
export {
  LlmExplainer,
  contradictsRisk,
  missingDiacritics,
  buildUserPrompt,
  SYSTEM_PROMPT,
  type LlmClient,
} from "./llm.ts";
export type { Explainer, ExplainInput } from "./types.ts";

/**
 * LLM_PROVIDER: `none` (templates only), `anthropic`, `gemini`, an OpenAI-compatible preset (`groq`, `openrouter`,
 * `cerebras`, `mistral`, `github-models`, `gemini-openai`) or `openai-compatible` with LLM_BASE_URL.
 */
export function createExplainer(env: {
  LLM_PROVIDER?: string | undefined;
  LLM_MODEL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  LLM_BASE_URL?: string | undefined;
  onFallback?: (reason: string) => void;
}): Explainer {
  const provider = (env.LLM_PROVIDER || "none").toLowerCase();
  if (provider === "none") return new TemplateExplainer();
  const known = ["anthropic", "gemini", "openai-compatible", ...Object.keys(OPENAI_COMPAT_PRESETS)];
  if (!known.includes(provider))
    throw new Error(`LLM_PROVIDER must be "none" or one of ${known.join(", ")}, got "${provider}"`);
  if (!env.LLM_API_KEY) throw new Error(`LLM_API_KEY is required when LLM_PROVIDER=${provider}`);
  const opts = env.onFallback ? { onFallback: env.onFallback } : {};
  const model = env.LLM_MODEL ? { model: env.LLM_MODEL } : {};
  if (provider === "anthropic")
    return new LlmExplainer(anthropicClient({ apiKey: env.LLM_API_KEY, ...model }), opts);
  if (provider === "gemini")
    return new LlmExplainer(geminiClient({ apiKey: env.LLM_API_KEY, ...model }), opts);
  const baseUrl = provider === "openai-compatible" ? env.LLM_BASE_URL : OPENAI_COMPAT_PRESETS[provider];
  if (!baseUrl) throw new Error("LLM_BASE_URL is required when LLM_PROVIDER=openai-compatible");
  if (!env.LLM_MODEL) throw new Error(`LLM_MODEL is required when LLM_PROVIDER=${provider}`);
  return new LlmExplainer(
    openAiCompatClient({ apiKey: env.LLM_API_KEY, baseUrl, model: env.LLM_MODEL }),
    opts,
  );
}
