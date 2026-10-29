import { z } from "zod/v4";
import { LLM_MAX_PARSE_RETRIES, DEBUG_LOG_TRUNCATE_LENGTH } from "../constants";
import { backoffMs } from "./client";

export async function parseWithRetry<T>(
  fetcher: () => Promise<string | null>,
  schema: z.ZodType<T>,
  contextName: string,
  transform?: (parsed: unknown) => unknown,
  options?: { deadlineAt?: number; maxRetries?: number },
): Promise<T | null> {
  const maxParseRetries = options?.maxRetries ?? LLM_MAX_PARSE_RETRIES;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) return null;
    let text: string | null;
    try {
      text = await fetcher();
    } catch (err) {
      console.error(`[llm] ${contextName} failed:`, err);
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
        `[llm] ${contextName} invalid JSON (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
        text.slice(0, DEBUG_LOG_TRUNCATE_LENGTH),
      );
      if (attempt < maxParseRetries) {
        const delayMs = getRetryDelay(attempt, options?.deadlineAt);
        if (delayMs <= 0) return null;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return null;
    }

    if (transform) {
      try {
        parsed = transform(parsed);
      } catch {
        if (attempt < maxParseRetries) {
          const delayMs = getRetryDelay(attempt, options?.deadlineAt);
          if (delayMs <= 0) return null;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        return null;
      }
    }

    try {
      return schema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.warn(
          `[llm] ${contextName} parse error (attempt ${attempt + 1}/${maxParseRetries + 1}):`,
          err.issues,
        );
      }
      if (attempt < maxParseRetries) {
        const delayMs = getRetryDelay(attempt, options?.deadlineAt);
        if (delayMs <= 0) return null;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return null;
    }
  }
  return null;
}

function getRetryDelay(attempt: number, deadlineAt?: number): number {
  const delayMs = backoffMs(attempt);
  return deadlineAt === undefined
    ? delayMs
    : Math.min(delayMs, Math.max(0, deadlineAt - Date.now()));
}
