import { SCORING_PROMPT } from "./prompts";
import { LLM_SINGLE_MAX_TOKENS, LLM_SINGLE_TIMEOUT_MS } from "../constants";
import { callGemini } from "./client";
import { LLMResponseSchema, LLMResponse, ArticleInput } from "./schemas";
import { parseWithRetry } from "./parser";

/** Score a single article via Gemini LLM. */
export async function scoreArticle(article: ArticleInput): Promise<LLMResponse | null> {
  const prompt = SCORING_PROMPT.replace("{{title}}", article.title).replace(
    "{{description}}",
    article.description ?? "(no description)",
  );

  return parseWithRetry(
    () => callGemini(prompt, LLM_SINGLE_MAX_TOKENS, LLM_SINGLE_TIMEOUT_MS),
    LLMResponseSchema,
    `Scoring failed for "${article.title}"`,
  );
}
