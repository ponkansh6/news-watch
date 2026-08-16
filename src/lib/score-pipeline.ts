import pLimit from "p-limit";
import { scoreArticles, buildPreferencePromptSection } from "@/lib/llm";
import { upsertArticles, getLatestPreferenceProfile } from "@/lib/db";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import {
  LLM_BATCH_SIZE,
  JAPANESE_RATIO_THRESHOLD,
  JAPANESE_LARGE_BATCH,
  LLM_BATCH_CONCURRENCY,
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
  options?: { preferenceSection?: string },
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

  const batchSize = getBatchSize(articles);
  const batches: NormalizedArticle[][] = [];
  for (let start = 0; start < articles.length; start += batchSize) {
    batches.push(articles.slice(start, start + batchSize));
  }

  const limit = pLimit(LLM_BATCH_CONCURRENCY);
  const counts = await Promise.all(
    batches.map((batch) => limit(() => scoreAndSaveBatch(batch, preferenceSection))),
  );

  return counts.reduce((sum, c) => sum + c, 0);
}

/** Score a batch of articles via LLM and persist to DB. */
async function scoreAndSaveBatch(
  batch: NormalizedArticle[],
  preferenceSection: string,
): Promise<number> {
  const llmResults = await scoreArticles(
    batch.map((a) => ({ title: a.title, description: a.description })),
    preferenceSection,
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
      keyword: llmResult?.topic ?? null,
      summary: llmResult?.summary ?? null,
      relevance,
      usefulness,
      recency,
      score: composite,
      reason: llmResult?.reason ?? null,
      scoredAt: new Date().toISOString(),
      recencyRefreshedAt: new Date().toISOString(),
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
}
