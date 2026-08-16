import { BATCH_SCORING_PROMPT } from "./prompts";
import { LLM_BATCH_MAX_TOKENS, LLM_BATCH_TIMEOUT_MS } from "../constants";
import { callGemini } from "./client";
import { LLMBatchResponseSchema, LLMResponse, ArticleInput } from "./schemas";
import { scoreArticle } from "./single";
import { parseWithRetry } from "./parser";

/** Score multiple articles in a single LLM call (batch). */
export async function scoreArticles(
  articles: ArticleInput[],
  preferenceSection = "",
): Promise<(LLMResponse | null)[]> {
  if (articles.length === 0) return [];

  const articlesBlock = articles
    .map(
      (a, i) => `${i + 1}. Title: ${a.title} | Description: ${a.description ?? "(no description)"}`,
    )
    .join("\n");

  const prompt = BATCH_SCORING_PROMPT.replace("{{articleCount}}", () => String(articles.length))
    .replace("{{preferenceSection}}", () => preferenceSection)
    .replace("{{articles}}", () => articlesBlock);

  const parsedArray = await parseWithRetry(
    () => callGemini(prompt, LLM_BATCH_MAX_TOKENS, LLM_BATCH_TIMEOUT_MS),
    LLMBatchResponseSchema,
    "Batch scoring",
    (parsed) => {
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)?.results)
          ? ((parsed as Record<string, unknown>).results as unknown[])
          : null;
      if (!arr) throw new Error("Expected array or {results:[...]}");
      return arr;
    },
  );

  if (!parsedArray) {
    console.warn(
      `[llm] Batch scoring failed or returned invalid array, falling back to single-article scoring`,
    );
    return await Promise.all(articles.map((a) => scoreArticle(a, preferenceSection)));
  }

  const padded: (LLMResponse | null)[] = articles.map((_, i) => {
    const r = parsedArray[i] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      summary: (typeof r.summary === "string" && r.summary) || "(no summary)",
      usefulness: typeof r.usefulness === "number" ? r.usefulness : 0,
      ntt_relevance: typeof r.ntt_relevance === "number" ? r.ntt_relevance : 0,
      reason: (typeof r.reason === "string" && r.reason) || "(no reason)",
    };
  });

  if (padded.every((r) => r === null) && articles.length > 0) {
    console.warn(
      `[llm] Batch scoring returned all nulls for ${articles.length} articles, falling back to single-article scoring`,
    );
    return await Promise.all(articles.map((a) => scoreArticle(a, preferenceSection)));
  }

  return padded;
}
