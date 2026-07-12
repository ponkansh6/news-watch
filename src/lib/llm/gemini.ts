import { z } from "zod/v4";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "./prompts";

/** LLM model used for article scoring (Gemini). */
export const LLM_MODEL = "gemini-3.1-flash-lite";

const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(100),
  usefulness: z.number().min(0).max(10),
  reason: z.string().min(1).max(200),
});

/** Lenient schema for batch mode — Gemini sometimes returns empty strings for
 *  summary/reason in batch responses. We accept and pad them with defaults. */
const LLMBatchItemSchema = z.object({
  summary: z.string().max(100),
  usefulness: z.number().min(0).max(10),
  reason: z.string().max(200),
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
function backoffMs(attempt: number, baseMs = 2000): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
}

async function callGemini(
  prompt: string,
  maxTokens: number,
  _timeoutMs: number, // Kept for signature compatibility, though Gemini SDK handles timeouts differently
  retries = 3,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: LLM_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens,
      temperature: 0.1,
    },
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      return text;
    } catch (err: any) {
      // Check for rate limit (429) or transient errors
      const isRateLimit = err.status === 429 || /429|rate limit/i.test(err.message);
      const isTransient = /5\d\d|overloaded|unavailable|timeout/i.test(err.message);

      if ((isRateLimit || isTransient) && attempt < retries) {
        const waitMs = backoffMs(attempt);
        console.warn(
          `[llm] Gemini ${isRateLimit ? "rate limit" : "transient error"}: ${err.message} (retry ${attempt + 1}/${retries}), waiting ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const error = new Error(
        `Gemini API error: ${err.message} (status: ${err.status ?? "unknown"})`,
      );
      error.cause = err;
      throw error;
    }
  }
  throw new Error("Gemini API call failed after retries");
}

/** Score a single article via Gemini LLM. */
export async function scoreArticle(article: ArticleInput): Promise<LLMResponse | null> {
  if (!process.env.GOOGLE_API_KEY) return null;

  const prompt = SCORING_PROMPT.replace("{{title}}", article.title).replace(
    "{{description}}",
    article.description ?? "(no description)",
  );

  // Retry on JSON/parse failures (unstable model may produce bad output)
  const maxParseRetries = 2;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    let text: string | null;
    try {
      text = await callGemini(prompt, 500, 30_000);
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
        text.slice(0, 100),
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
  const maxParseRetries = 2;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    let text: string | null;
    try {
      text = await callGemini(prompt, 6000, 55_000);
    } catch (err) {
      console.error(`[llm] Batch scoring failed:`, err);
      return articles.map(() => null);
    }
    if (!text) {
      return articles.map(() => null);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      console.warn(
        `[llm] batch invalid JSON (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
        text.slice(0, 100),
      );
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return articles.map(() => null);
    }

    // Accept either a bare array or an object wrapping it under `results`
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.results)
        ? (parsed as any).results
        : null;

    if (!arr) {
      console.warn(
        `[llm] batch: expected array or {results:[...]} (attempt ${attempt + 1}/${maxParseRetries + 1})`,
      );
      if (attempt < maxParseRetries) {
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return articles.map(() => null);
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
      return articles.map(() => null);
    }
  }
  return articles.map(() => null);
}
