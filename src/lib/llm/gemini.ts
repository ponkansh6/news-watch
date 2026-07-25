import { z } from "zod/v4";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "./prompts";
import {
  LLM_RESPONSE_SUMMARY_MAX,
  LLM_RESPONSE_USEFULNESS_MAX,
  LLM_RESPONSE_REASON_MAX,
  LLM_SINGLE_MAX_TOKENS,
  LLM_SINGLE_TIMEOUT_MS,
  LLM_BATCH_MAX_TOKENS,
  LLM_BATCH_TIMEOUT_MS,
  LLM_GEN_TEMPERATURE,
  LLM_MAX_RETRIES,
  LLM_MAX_PARSE_RETRIES,
  LLM_BACKOFF_BASE_MS,
  DEBUG_LOG_TRUNCATE_LENGTH,
} from "../constants";

/** LLM model used for article scoring (Gemini). */
export const LLM_MODEL = "gemini-3.1-flash-lite";

const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  reason: z.string().min(1).max(LLM_RESPONSE_REASON_MAX),
});

/** Lenient schema for batch mode — Gemini sometimes returns empty strings for
 *  summary/reason in batch responses. We accept and pad them with defaults. */
const LLMBatchItemSchema = z.object({
  summary: z.string().max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  reason: z.string().max(LLM_RESPONSE_REASON_MAX),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

export type { LLMResponse };

export interface ArticleInput {
  title: string;
  description: string | null;
}

/**
 * Exponential backoff with jitter to avoid thundering herd.
 * Base delay * 2^attempt + random jitter [0, baseDelay).
 */
function backoffMs(attempt: number, baseMs = LLM_BACKOFF_BASE_MS): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
}

async function callGemini(
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
  retries = LLM_MAX_RETRIES,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: LLM_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens,
      temperature: LLM_GEN_TEMPERATURE,
    },
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt, { timeout: timeoutMs });
      const response = await result.response;
      const text = response.text();
      return text;
    } catch (err: unknown) {
      // Check for rate limit (429) or transient errors
      const apiError = err as { status?: number; message?: string };
      const isRateLimit =
        apiError.status === 429; /* eslint-disable-line @typescript-eslint/no-magic-numbers */
      const isTransient = /5\d\d|overloaded|unavailable|timeout/i.test(apiError.message ?? "");

      if ((isRateLimit || isTransient) && attempt < retries) {
        const waitMs = backoffMs(attempt);
        console.warn(
          `[llm] Gemini ${isRateLimit ? "rate limit" : "transient error"}: ${apiError.message} (retry ${attempt + 1}/${retries}), waiting ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const error = new Error(
        `Gemini API error: ${apiError.message} (status: ${apiError.status ?? "unknown"})`,
      );
      error.cause = apiError;
      throw error;
    }
  }
  throw new Error("Gemini API call failed after retries");
}

/** Score a single article via Gemini LLM. */
export async function scoreArticle(article: ArticleInput): Promise<LLMResponse | null> {
  const prompt = SCORING_PROMPT.replace("{{title}}", article.title).replace(
    "{{description}}",
    article.description ?? "(no description)",
  );

  // Retry on JSON/parse failures (unstable model may produce bad output)
  const maxParseRetries = LLM_MAX_PARSE_RETRIES;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    let text: string | null;
    try {
      text = await callGemini(prompt, LLM_SINGLE_MAX_TOKENS, LLM_SINGLE_TIMEOUT_MS);
    } catch (err) {
      console.error(`[llm] Scoring failed for "${article.title}":`, err);
      return null;
    }
    if (!text) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      console.warn(
        `[llm] invalid JSON (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
        text.slice(0, DEBUG_LOG_TRUNCATE_LENGTH),
      );
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return null;
    }

    try {
      return LLMResponseSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.warn(
          `[llm] parse error (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
          err.issues,
        );
      }
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return null;
    }
  }
  return null;
}

const LLMBatchResponseSchema = z.array(LLMBatchItemSchema);

/** Score multiple articles in a single LLM call (batch). */
export async function scoreArticles(articles: ArticleInput[]): Promise<(LLMResponse | null)[]> {
  if (articles.length === 0) return [];

  const articlesBlock = articles
    .map(
      (a, i) => `${i + 1}. Title: ${a.title} | Description: ${a.description ?? "(no description)"}`,
    )
    .join("\n");

  const prompt = BATCH_SCORING_PROMPT.replace("{{articleCount}}", String(articles.length)).replace(
    "{{articles}}",
    articlesBlock,
  );

  // Retry on JSON/parse failures
  const maxParseRetries = LLM_MAX_PARSE_RETRIES;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    let text: string | null;
    try {
      text = await callGemini(prompt, LLM_BATCH_MAX_TOKENS, LLM_BATCH_TIMEOUT_MS);
    } catch (err) {
      console.error(`[llm] Batch scoring failed:`, err);
      break;
    }
    if (!text) {
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      console.warn(
        `[llm] batch invalid JSON (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
        text.slice(0, DEBUG_LOG_TRUNCATE_LENGTH),
      );
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      break;
    }

    // Accept either a bare array or an object wrapping it under `results`
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.results)
        ? ((parsed as Record<string, unknown>).results as unknown[])
        : null;

    if (!arr) {
      console.warn(
        `[llm] batch: expected array or {results:[...]} (attempt ${attempt + 1}/${maxParseRetries + 1})`,
      );
      if (articles.length > 0) {
        console.warn(`[llm] Batch scoring invalid array, falling back to single-article scoring`);
        const singleResults = await Promise.all(articles.map((a) => scoreArticle(a)));
        return singleResults;
      }
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      break;
    }

    try {
      const results = LLMBatchResponseSchema.parse(arr);
      const padded: (LLMResponse | null)[] = articles.map((_, i) => {
        const r = results[i];
        if (!r) return null;
        return {
          summary: r.summary || "(no summary)",
          usefulness: r.usefulness,
          reason: r.reason || "(no reason)",
        };
      });

      // 全記事がnullの場合、個別スコアリングにフォールバック
      if (padded.every((r) => r === null) && articles.length > 0) {
        console.warn(
          `[llm] Batch scoring returned all nulls for ${articles.length} articles, falling back to single-article scoring`,
        );
        return await Promise.all(articles.map((a) => scoreArticle(a)));
      }

      return padded;
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.warn(
          `[llm] batch parse error (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
          err.issues,
        );
      }
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      // zod parse 失敗が最終試行でも起きたら、個別スコアリングにフォールバック
      console.warn(
        `[llm] Batch scoring Zod validation failed all attempts, falling back to single-article scoring`,
      );
      return await Promise.all(articles.map((a) => scoreArticle(a)));
    }
  }

  // 全リトライが尽きても失敗した場合のフォールバック
  if (articles.length > 0) {
    console.warn(
      `[llm] Batch scoring failed all attempts for ${articles.length} articles, falling back to single-article scoring`,
    );
    const singleResults = [];
    for (const a of articles) {
      singleResults.push(await scoreArticle(a));
    }
    return singleResults;
  }

  return articles.map(() => null);
}
