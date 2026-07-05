import { z } from "zod/v4";
import { SCORING_PROMPT } from "./prompts";

const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(100),
  relevance: z.number().min(0).max(10),
  usefulness: z.number().min(0).max(10),
  reason: z.string().min(1).max(200),
});

type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface ArticleInput {
  title: string;
  description: string | null;
}

/** Score a single article via Google Gemini/Gemma API (free tier). */
export async function scoreArticle(
  article: ArticleInput,
  keyword: string,
): Promise<LLMResponse | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const prompt = SCORING_PROMPT.replace("{{keyword}}", keyword)
    .replace("{{title}}", article.title)
    .replace("{{description}}", article.description ?? "(no description)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            max_output_tokens: 500,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      console.warn(`[llm] Gemini HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: {
          parts?: { text?: string; thought?: boolean }[];
        };
      }[];
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      console.warn(`[llm] blocked:`, data.promptFeedback.blockReason);
      return null;
    }

    // Pick the last non-thought part (handles thinking models like Gemma 4)
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text =
      parts
        .filter((p) => !p.thought)
        .at(-1)
        ?.text?.trim() ??
      parts.at(-1)?.text?.trim() ??
      null;
    if (!text) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      console.warn(`[llm] invalid JSON:`, text.slice(0, 100));
      return null;
    }

    return LLMResponseSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn(`[llm] parse error:`, err.issues);
    } else if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[llm] timeout`);
    } else {
      console.warn(`[llm] error:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}