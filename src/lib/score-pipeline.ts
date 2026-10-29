import { scoreArticles, buildPreferencePromptSection } from "@/lib/llm";
import { upsertArticles, getLatestPreferenceProfile } from "@/lib/db";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { computeContentHash, computeScoringSignature } from "./scoring-signature";
import {
  LLM_BATCH_SIZE,
  JAPANESE_RATIO_THRESHOLD,
  JAPANESE_LARGE_BATCH,
  NTT_TAG_RELEVANCE_THRESHOLD,
  LLM_BATCH_MAX_RETRIES,
  LLM_BATCH_TIMEOUT_MS,
  SCORING_DEADLINE_MS,
  SCORING_MIN_SLICE_MS,
} from "./constants";
import type { NormalizedArticle } from "@/lib/types";
import type { GeminiLeaseEvidence } from "@/lib/db/repository/gemini-rate-limit-repository";

function getBatchSize(articles: NormalizedArticle[]): number {
  if (articles.length === 0) return LLM_BATCH_SIZE;
  const japaneseRatio =
    articles.filter((a) => /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(a.title)).length /
    articles.length;
  return japaneseRatio > JAPANESE_RATIO_THRESHOLD ? JAPANESE_LARGE_BATCH : LLM_BATCH_SIZE;
}

/** Score articles in batches of LLM_BATCH_SIZE via LLM, and save. */
export async function scoreAndSaveTagged(
  articles: NormalizedArticle[],
  options?: {
    preferenceSection?: string;
    signature?: string;
    onScoringError?: (message: string) => void;
    onScoringSuccess?: () => void;
    onScoringProgress?: (completed: number, failed: number, total: number) => void;
    leaseEvidence?: GeminiLeaseEvidence;
  },
): Promise<number> {
  let preferenceSection = "";
  if (options?.preferenceSection !== undefined) {
    preferenceSection = options.preferenceSection;
  } else {
    try {
      const profile = await getLatestPreferenceProfile();
      preferenceSection = buildPreferencePromptSection(profile?.analysis ?? null);
    } catch (err) {
      console.warn(`[pipeline] Failed to load preference profile, continuing without it:`, err);
    }
  }

  const signature = options?.signature ?? computeScoringSignature(preferenceSection);
  const deadline = Date.now() + SCORING_DEADLINE_MS;

  const batchSize = getBatchSize(articles);
  const batches: NormalizedArticle[][] = [];
  for (let start = 0; start < articles.length; start += batchSize) {
    batches.push(articles.slice(start, start + batchSize));
  }

  let completed = 0;
  let failed = 0;
  const reportProgress = (isFailure: boolean) => {
    completed = Math.min(articles.length, completed + 1);
    if (isFailure) failed++;
    options?.onScoringProgress?.(completed, failed, articles.length);
  };
  let savedCount = 0;
  for (const batch of batches) {
    try {
      savedCount += await scoreAndSaveBatch(
        batch,
        preferenceSection,
        signature,
        deadline,
        options?.onScoringError,
        options?.onScoringSuccess,
        reportProgress,
        options?.leaseEvidence,
      );
    } catch (err) {
      console.error("[pipeline] Unexpected batch scoring failure:", err);
    }
  }

  return savedCount;
}

/** Score a batch of articles via LLM and persist to DB. */
async function scoreAndSaveBatch(
  batch: NormalizedArticle[],
  preferenceSection: string,
  signature: string,
  deadline: number,
  onScoringError?: (message: string) => void,
  onScoringSuccess?: () => void,
  onScoringProgress?: (isFailure: boolean) => void,
  leaseEvidence?: GeminiLeaseEvidence,
): Promise<number> {
  let processed = 0;
  try {
    const remaining = deadline - Date.now();
    if (remaining < SCORING_MIN_SLICE_MS) {
      onScoringError?.("Scoring deadline exceeded");
      for (let i = 0; i < batch.length; i++) {
        onScoringProgress?.(true);
        processed++;
      }
      return 0;
    }

    const llmResults = await scoreArticles(
      batch.map((a) => ({ title: a.title, description: a.description })),
      preferenceSection,
      {
        timeoutMs: Math.min(LLM_BATCH_TIMEOUT_MS, remaining),
        retries: LLM_BATCH_MAX_RETRIES,
        leaseEvidence,
      },
    );

    const upsertList = [];
    const llmSuccessUrls = new Set<string>();

    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      const llmResult = llmResults[i] ?? null;
      if (!llmResult) {
        onScoringError?.("LLM returned no scoring result for an article");
        onScoringProgress?.(true);
        processed++;
        // A missing score must remain eligible for a later scoring run.
        // Persisting a null score with scoredAt/signature makes the selector
        // treat the failed article as already scored.
        continue;
      } else {
        onScoringSuccess?.();
        onScoringProgress?.(false);
        processed++;
      }
      const usefulness = llmResult.usefulness ?? null;
      const relevance = llmResult.ntt_relevance ?? 0;
      const recency = calcRecencyScore(article.publishedAt);
      const composite = calcCompositeScore(relevance, usefulness, recency);

      upsertList.push({
        title: article.title,
        description: article.description,
        url: article.url,
        urlToImage: article.urlToImage,
        publishedAt: article.publishedAt,
        sourceName: article.sourceName,
        sourceId: article.sourceId,
        author: article.author,
        keyword: relevance >= NTT_TAG_RELEVANCE_THRESHOLD ? "NTT" : null,
        summary: llmResult.summary ?? null,
        relevance,
        usefulness,
        recency,
        score: composite,
        reason: llmResult.reason ?? null,
        scoredAt: new Date().toISOString(),
        recencyRefreshedAt: new Date().toISOString(),
        contentHash: computeContentHash(article.title, article.description),
        scoringSignature: signature,
      });

      llmSuccessUrls.add(article.url);
    }

    const result =
      upsertList.length > 0 ? await upsertArticles(upsertList) : { succeeded: [], failed: [] };

    let savedCount = 0;
    for (const url of result.succeeded) {
      if (llmSuccessUrls.has(url)) savedCount++;
    }

    for (const url of result.failed) {
      const article = batch.find((a) => a.url === url);
      if (article) console.error(`[pipeline] Failed to save article "${article.title}"`);
    }

    return savedCount;
  } catch (err) {
    console.error(`[pipeline] Batch scoring/saving failed:`, err);
    onScoringError?.(err instanceof Error ? err.message : String(err));
    // The batch result could not be established; count each article as processed and failed.
    for (let i = processed; i < batch.length; i++) onScoringProgress?.(true);
    return 0;
  }
}
