import { z } from "zod/v4";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "./prompts";

/** LLM model used for article scoring (Groq-hosted, OpenAI-compatible API). */
export const LLM_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const LLM_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(100),
  relevance: z.number().min(0).max(10),
  usefulness: z.number().min(0).max(10),
  reason: z.string().min(1).max(200),
});

/** Lenient schema for batch mode — Groq sometimes returns empty strings for
 *  summary/reason in batch responses. We accept and pad them with defaults. */
const LLMBatchItemSchema = z.object({
  summary: z.string().max(100),
  relevance: z.number().min(0).max(10),
  usefulness: z.number().min(0).max(10),
  reason: z.string().max(200),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

export type { LLMResponse };

export interface ArticleInput {
  title: string;
  description: string | null;
}

async function callGroq(prompt: string, maxTokens: number, timeoutMs: number, retries = 3): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(LLM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        console.warn(`[llm] Groq HTTP ${res.status} (retry ${attempt + 1}/${retries})`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
        return null;
      }

      if (!res.ok) {
        console.warn(`[llm] Groq HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };

      if (data.error) {
        console.warn(`[llm] Groq error:`, data.error.message);
        return null;
      }

      const text = data.choices?.[0]?.message?.content?.trim() ?? null;
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.warn(`[llm] timeout`);
        return null;
      }
      console.warn(`[llm] error:`, err);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Score a single article via Groq LLM. */
export async function scoreArticle(
  article: ArticleInput,
  keyword: string,
): Promise<LLMResponse | null> {
  const prompt = SCORING_PROMPT.replace("{{keyword}}", keyword)
    .replace("{{title}}", article.title)
    .replace("{{description}}", article.description ?? "(no description)");

  const text = await callGroq(prompt, 500, 30_000);
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    console.warn(`[llm] invalid JSON:`, text.slice(0, 100));
    return null;
  }

  try {
    return LLMResponseSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn(`[llm] parse error:`, err.issues);
    }
    return null;
  }
}

const LLMBatchResponseSchema = z.array(LLMBatchItemSchema);

/** Score multiple articles in a single LLM call (batch). */
export async function scoreArticles(
  articles: ArticleInput[],
  keyword: string,
): Promise<(LLMResponse | null)[]> {
  if (articles.length === 0) return [];

  const articlesBlock = articles
    .map(
      (a, i) => `${i + 1}. Title: ${a.title} | Description: ${a.description ?? "(no description)"}`,
    )
    .join("\n");

  const prompt = BATCH_SCORING_PROMPT.replace("{{articleCount}}", String(articles.length))
    .replace("{{keyword}}", keyword)
    .replace("{{articles}}", articlesBlock);

  const text = await callGroq(prompt, 4000, 55_000);
  if (!text) return articles.map(() => null);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    console.warn(`[llm] invalid JSON:`, text.slice(0, 100));
    return articles.map(() => null);
  }

  // Accept either a bare array or an object wrapping it under `results`
  // (Groq's json_object mode requires a top-level object).
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any)?.results)
      ? (parsed as any).results
      : null;

  if (!arr) {
    console.warn(`[llm] batch: expected array or {results:[...]}`);
    return articles.map(() => null);
  }

  try {
    const results = LLMBatchResponseSchema.parse(arr);
    const padded: (LLMResponse | null)[] = articles.map((_, i) => {
      const r = results[i];
      if (!r) return null;
      return {
        summary: r.summary || "(no summary)",
        relevance: r.relevance,
        usefulness: r.usefulness,
        reason: r.reason || "(no reason)",
      };
    });
    return padded;
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn(`[llm] batch parse error:`, err.issues);
    }
    return articles.map(() => null);
  }
}
