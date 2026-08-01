import { GoogleGenerativeAI } from "@google/generative-ai";
import { LLM_MAX_RETRIES, LLM_BACKOFF_BASE_MS, LLM_GEN_TEMPERATURE } from "../constants";

/** LLM model used for article scoring (Gemini). */
export const LLM_MODEL = "gemini-3.1-flash-lite";

/**
 * Exponential backoff with jitter to avoid thundering herd.
 * Base delay * 2^attempt + random jitter [0, baseDelay).
 */
export function backoffMs(attempt: number, baseMs = LLM_BACKOFF_BASE_MS): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
}

export async function callGemini(
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
