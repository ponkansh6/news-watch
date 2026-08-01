import { z } from "zod/v4";
import { LLM_MAX_PARSE_RETRIES, DEBUG_LOG_TRUNCATE_LENGTH } from "../constants";
import { backoffMs } from "./client";

export async function parseWithRetry<T>(
  fetcher: () => Promise<string | null>,
  schema: z.ZodType<T>,
  contextName: string,
  transform?: (parsed: unknown) => unknown,
): Promise<T | null> {
  const maxParseRetries = LLM_MAX_PARSE_RETRIES;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
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
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return null;
    }

    if (transform) {
      try {
        parsed = transform(parsed);
      } catch {
        if (attempt < maxParseRetries) {
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
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
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      return null;
    }
  }
  return null;
}
