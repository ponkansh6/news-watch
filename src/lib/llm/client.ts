import { GoogleGenerativeAI } from "@google/generative-ai";
import { LLM_MAX_RETRIES, LLM_BACKOFF_BASE_MS, LLM_GEN_TEMPERATURE } from "../constants";
import {
  beginGeminiAttempt,
  claimGeminiAttempt,
  completeGeminiAttempt,
  type GeminiLeaseEvidence,
  type GeminiLeaseKind,
  type GeminiAttemptOwner,
} from "@/lib/db/repository/gemini-rate-limit-repository";

/** LLM model used for article scoring (Gemini). */
export const LLM_MODEL = "gemini-3.1-flash-lite";

/** Build lease evidence only when Vercel provides a concrete deployment ID. */
export function geminiLeaseEvidence(kind: GeminiLeaseKind): GeminiLeaseEvidence | undefined {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (!deploymentId) return undefined;
  return { kind, deploymentId };
}

export class GeminiSlotWaitError extends Error {
  constructor(
    readonly recoverable: boolean,
    readonly retryAfterMs?: number,
    readonly attemptsSent = 0,
  ) {
    super("Gemini shared send slot is not available yet");
    this.name = "GeminiSlotWaitError";
  }
}

export interface GeminiCallOptions {
  /** Return control to a durable workflow so it can sleep and retry later. */
  rateWaitMode?: "sleep" | "throw";
  /** Explicit execution context used to qualify automatic lease recovery. */
  leaseEvidence?: GeminiLeaseEvidence;
  /** Counts actual HTTP attempts for a caller coordinating durable retries. */
  onHttpAttempt?: () => void;
}

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
  deadlineAt?: number,
  options?: GeminiCallOptions,
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

  const requestDeadline = deadlineAt ?? Date.now() + timeoutMs * (retries + 1);
  let attemptsSent = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let owner: GeminiAttemptOwner;
    while (true) {
      const remainingWaitMs = requestDeadline - Date.now();
      if (remainingWaitMs <= 0)
        throw new Error("Gemini request deadline exceeded while waiting for shared slot");
      const claim = await claimGeminiAttempt(options?.leaseEvidence);
      if (claim.kind === "claimed") {
        owner = claim.owner;
        break;
      }
      const recoverable = claim.kind === "rate-limited" || claim.recoverable;
      const waitMs =
        claim.kind === "rate-limited" || claim.recoverable ? claim.retryAfterMs : undefined;
      if (options?.rateWaitMode === "throw") {
        throw new GeminiSlotWaitError(recoverable, waitMs, attemptsSent);
      }
      if (!recoverable || waitMs === undefined) {
        throw new Error("Gemini shared send slot has an unrecoverable owner");
      }
      const boundedWaitMs = Math.min(waitMs, remainingWaitMs);
      if (boundedWaitMs <= 0)
        throw new Error("Gemini request deadline exceeded while waiting for shared slot");
      await new Promise((resolve) => setTimeout(resolve, boundedWaitMs));
    }

    const remainingMs = requestDeadline - Date.now();
    if (remainingMs <= 0) {
      // Claiming an owner does not start an attempt, so release it by recording
      // a conservative failed attempt rather than leaving an unowned slot.
      const attemptId = await beginGeminiAttempt(owner);
      const released = await completeGeminiAttempt(owner, attemptId, "failed");
      if (!released) throw new Error("failed_to_release_expired_gemini_attempt");
      throw new Error("Gemini request deadline exceeded");
    }

    const attemptId = await beginGeminiAttempt(owner);
    attemptsSent++;
    options?.onHttpAttempt?.();
    let responseText: string;
    try {
      const result = await model.generateContent(prompt, {
        timeout: Math.min(timeoutMs, remainingMs),
      });
      const response = await result.response;
      responseText = response.text();
    } catch (err: unknown) {
      // Persist every network attempt before retrying. A failed write leaves
      // the owner held, preventing another worker from sending around it.
      const released = await completeGeminiAttempt(owner, attemptId, "failed");
      if (!released) throw new Error("failed_to_record_gemini_attempt");

      // Check for rate limit (429) or transient errors
      const apiError = err as { status?: number; message?: string };
      const isRateLimit =
        apiError.status === 429; /* eslint-disable-line @typescript-eslint/no-magic-numbers */
      const isTransient = /5\d\d|overloaded|unavailable|timeout/i.test(apiError.message ?? "");

      if ((isRateLimit || isTransient) && attempt < retries) {
        const waitMs = backoffMs(attempt);
        const retryDelayMs = Math.min(waitMs, Math.max(0, requestDeadline - Date.now()));
        console.warn(
          `[llm] Gemini ${isRateLimit ? "rate limit" : "transient error"}: ${apiError.message} (retry ${attempt + 1}/${retries}), waiting ${retryDelayMs}ms`,
        );
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }

      const error = new Error(
        `Gemini API error: ${apiError.message} (status: ${apiError.status ?? "unknown"})`,
      );
      error.cause = apiError;
      throw error;
    }

    const released = await completeGeminiAttempt(owner, attemptId, "succeeded");
    if (!released) throw new Error("failed_to_record_gemini_attempt");
    return responseText;
  }
  throw new Error("Gemini API call failed after retries");
}
