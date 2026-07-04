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

/** Score a single article via OpenRouter (Gemini 3.1 Flash Lite). */
export async function scoreArticle(
  article: ArticleInput,
  keyword: string,
): Promise<LLMResponse | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const prompt = SCORING_PROMPT.replace("{{keyword}}", keyword)
    .replace("{{title}}", article.title)
    .replace("{{description}}", article.description ?? "(no description)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-lite",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: 200,
          temperature: 0.1,
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      console.warn(`[llm] HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse JSON first, then validate with Zod
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      console.warn(`[llm] invalid JSON:`, content.slice(0, 100));
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
