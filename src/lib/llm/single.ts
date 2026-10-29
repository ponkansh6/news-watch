import { SCORING_PROMPT } from "./prompts";
import { LLM_SINGLE_MAX_TOKENS, LLM_SINGLE_TIMEOUT_MS } from "../constants";
import { callGemini } from "./client";
import { LLMResponseSchema, LLMResponse, ArticleInput } from "./schemas";
import { parseWithRetry } from "./parser";
import type { GeminiLeaseEvidence } from "@/lib/db/repository/gemini-rate-limit-repository";

/** Score a single article via Gemini LLM. */
export async function scoreArticle(
  article: ArticleInput,
  preferenceSection = "",
  options?: {
    timeoutMs?: number;
    retries?: number;
    deadlineAt?: number;
    maxParseRetries?: number;
    leaseEvidence?: GeminiLeaseEvidence;
  },
): Promise<LLMResponse | null> {
  const prompt = SCORING_PROMPT.replace("{{title}}", () => article.title)
    .replace("{{description}}", () => article.description ?? "(no description)")
    .replace("{{preferenceSection}}", () => preferenceSection);

  return parseWithRetry(
    () =>
      callGemini(
        prompt,
        LLM_SINGLE_MAX_TOKENS,
        options?.timeoutMs ?? LLM_SINGLE_TIMEOUT_MS,
        options?.retries,
        options?.deadlineAt,
        { leaseEvidence: options?.leaseEvidence },
      ),
    LLMResponseSchema,
    `Scoring failed for "${article.title}"`,
    undefined,
    { deadlineAt: options?.deadlineAt, maxRetries: options?.maxParseRetries },
  );
}
