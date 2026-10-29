import { BATCH_SCORING_BY_ID_PROMPT, BATCH_SCORING_PROMPT } from "./prompts";
import { LLM_BATCH_MAX_TOKENS, LLM_BATCH_TIMEOUT_MS, LLM_BATCH_MAX_RETRIES } from "../constants";
import { callGemini, GeminiSlotWaitError } from "./client";
import type { GeminiLeaseEvidence } from "@/lib/db/repository/gemini-rate-limit-repository";
import {
  LLMBatchResponseSchema,
  LLMIdentifiedBatchResponseSchema,
  LLMResponse,
  ArticleInput,
} from "./schemas";
import { scoreArticle } from "./single";
import { parseWithRetry } from "./parser";

const CROSS_SOURCE_BATCH_MAX_SIZE = 50;

export interface IdentifiedArticleInput extends ArticleInput {
  id: string;
}

export interface IdentifiedArticleScore {
  id: string;
  score: LLMResponse;
}

/** Score multiple articles in a single LLM call (batch). */
export async function scoreArticles(
  articles: ArticleInput[],
  preferenceSection = "",
  opts?: { timeoutMs?: number; retries?: number; leaseEvidence?: GeminiLeaseEvidence },
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

  const timeoutMs = opts?.timeoutMs ?? LLM_BATCH_TIMEOUT_MS;
  const retries = opts?.retries ?? LLM_BATCH_MAX_RETRIES;
  const deadlineAt = Date.now() + timeoutMs;

  const parsedArray = await parseWithRetry(
    () =>
      callGemini(prompt, LLM_BATCH_MAX_TOKENS, timeoutMs, retries, deadlineAt, {
        leaseEvidence: opts?.leaseEvidence,
      }),
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
    { deadlineAt },
  );

  if (!parsedArray) {
    console.warn(
      `[llm] Batch scoring failed or returned invalid array, falling back to sequential scoring`,
    );
    return await scoreFallbackSequentially(
      articles,
      preferenceSection,
      deadlineAt,
      opts?.leaseEvidence,
    );
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
      `[llm] Batch scoring returned all nulls for ${articles.length} articles, falling back to sequential scoring`,
    );
    return await scoreFallbackSequentially(
      articles,
      preferenceSection,
      deadlineAt,
      opts?.leaseEvidence,
    );
  }

  return padded;
}

/** Score a durable cross-source batch and validate the response by stable article id. */
export async function scoreArticlesById(
  articles: IdentifiedArticleInput[],
  preferenceSection = "",
  opts?: {
    timeoutMs?: number;
    retries?: number;
    rateWaitMode?: "sleep" | "throw";
    leaseEvidence?: GeminiLeaseEvidence;
  },
): Promise<IdentifiedArticleScore[]> {
  if (articles.length === 0) return [];
  if (articles.length > CROSS_SOURCE_BATCH_MAX_SIZE) {
    throw new Error(
      `Identified scoring batches may contain at most ${CROSS_SOURCE_BATCH_MAX_SIZE} articles`,
    );
  }

  const inputIds = new Set<string>();
  for (const article of articles) {
    if (!article.id || inputIds.has(article.id)) {
      throw new Error("Identified scoring batch contains an empty or duplicate input id");
    }
    inputIds.add(article.id);
  }

  const prompt = BATCH_SCORING_BY_ID_PROMPT.replace("{{articleCount}}", () =>
    String(articles.length),
  )
    .replace("{{preferenceSection}}", () => preferenceSection)
    .replace("{{articles}}", () =>
      JSON.stringify(articles.map(({ id, title, description }) => ({ id, title, description }))),
    );
  const timeoutMs = opts?.timeoutMs ?? LLM_BATCH_TIMEOUT_MS;
  const deadlineAt = Date.now() + timeoutMs;
  const retries = Math.max(0, Math.min(opts?.retries ?? LLM_BATCH_MAX_RETRIES, 3));
  let lastError: Error = new Error("Identified batch scoring failed");
  let attemptsSent = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (Date.now() >= deadlineAt) break;
    try {
      const raw = await callGemini(prompt, LLM_BATCH_MAX_TOKENS, timeoutMs, 0, deadlineAt, {
        rateWaitMode: opts?.rateWaitMode,
        leaseEvidence: opts?.leaseEvidence,
        onHttpAttempt: () => attemptsSent++,
      });
      if (!raw) throw new Error("Identified batch scoring returned an empty response");
      const parsed = LLMIdentifiedBatchResponseSchema.parse(JSON.parse(raw));
      const scoresById = new Map<string, LLMResponse>();
      for (const result of parsed.results) {
        if (!inputIds.has(result.id))
          throw new Error("Identified batch response contains an unknown id");
        if (scoresById.has(result.id))
          throw new Error("Identified batch response contains a duplicate id");
        scoresById.set(result.id, {
          summary: result.summary || "(no summary)",
          usefulness: result.usefulness,
          ntt_relevance: result.ntt_relevance,
          reason: result.reason || "(no reason)",
        });
      }
      if (scoresById.size !== inputIds.size)
        throw new Error("Identified batch response is missing ids");
      return articles.map(({ id }) => ({ id, score: scoresById.get(id)! }));
    } catch (error) {
      if (error instanceof GeminiSlotWaitError) {
        throw new GeminiSlotWaitError(error.recoverable, error.retryAfterMs, attemptsSent);
      }
      lastError = error instanceof Error ? error : new Error("Invalid identified batch response");
      if (attempt < retries) {
        const delayMs = Math.min(250 * 2 ** attempt, Math.max(0, deadlineAt - Date.now()));
        if (delayMs <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`Identified batch scoring failed after bounded retries: ${lastError.message}`, {
    cause: lastError,
  });
}

async function scoreFallbackSequentially(
  articles: ArticleInput[],
  preferenceSection: string,
  deadlineAt: number,
  leaseEvidence?: GeminiLeaseEvidence,
): Promise<(LLMResponse | null)[]> {
  const results: (LLMResponse | null)[] = [];
  for (const article of articles) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      results.push(...articles.slice(results.length).map(() => null));
      break;
    }
    results.push(
      await scoreArticle(article, preferenceSection, {
        timeoutMs: remainingMs,
        retries: 0,
        deadlineAt,
        maxParseRetries: 0,
        leaseEvidence,
      }),
    );
  }
  return results;
}
