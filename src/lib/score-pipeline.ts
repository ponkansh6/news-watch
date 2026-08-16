import pLimit from "p-limit";
import { scoreArticles, buildPreferencePromptSection } from "@/lib/llm";
import { upsertArticles, getLatestPreferenceProfile } from "@/lib/db";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { computeContentHash, computeScoringSignature } from "./scoring-signature";
import {
  LLM_BATCH_SIZE,
  JAPANESE_RATIO_THRESHOLD,
  JAPANESE_LARGE_BATCH,
  LLM_BATCH_CONCURRENCY,
  NTT_TAG_RELEVANCE_THRESHOLD,
  LLM_BATCH_MAX_RETRIES,
  LLM_BATCH_TIMEOUT_MS,
  SCORING_DEADLINE_MS,
  SCORING_MIN_SLICE_MS,
} from "./constants";
import type { NormalizedArticle } from "@/lib/types";

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
  options?: { preferenceSection?: string; signature?: string },
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

  const limit = pLimit(LLM_BATCH_CONCURRENCY);
  const settled = await Promise.allSettled(
    batches.map((batch) =>
      limit(() => scoreAndSaveBatch(batch, preferenceSection, signature, deadline)),
    ),
  );

  return settled.reduce((sum, s) => sum + (s.status === "fulfilled" ? s.value : 0), 0);
}

/** Score a batch of articles via LLM and persist to DB. */
async function scoreAndSaveBatch(
  batch: NormalizedArticle[],
  preferenceSection: string,
  signature: string,
  deadline: number,
): Promise<number> {
  try {
    const remaining = deadline - Date.now();
    if (remaining < SCORING_MIN_SLICE_MS) return 0;

    const llmResults = await scoreArticles(
      batch.map((a) => ({ title: a.title, description: a.description })),
      preferenceSection,
      { timeoutMs: Math.min(LLM_BATCH_TIMEOUT_MS, remaining), retries: LLM_BATCH_MAX_RETRIES },
    );

    const upsertList = [];
    const llmSuccessUrls = new Set<string>();

    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      const llmResult = llmResults[i] ?? null;
      const usefulness = llmResult?.usefulness ?? null;
      const relevance = llmResult?.ntt_relevance ?? 0;
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
        summary: llmResult?.summary ?? null,
        relevance,
        usefulness,
        recency,
        score: composite,
        reason: llmResult?.reason ?? null,
        scoredAt: new Date().toISOString(),
        recencyRefreshedAt: new Date().toISOString(),
        contentHash: computeContentHash(article.title, article.description),
        scoringSignature: signature,
      });

      if (llmResult) llmSuccessUrls.add(article.url);
    }

    const result = await upsertArticles(upsertList);

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
    return 0;
  }
}
