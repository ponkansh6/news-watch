import pLimit from "p-limit";
import { scoreArticles } from "@/lib/llm";
import { upsertArticles } from "@/lib/db";
import {
  calcRecencyScore,
  calcCompositeScore,
  normalizeSimilaritiesWithTagged,
} from "@/lib/scoring";
import {
  LLM_BATCH_SIZE,
  JAPANESE_RATIO_THRESHOLD,
  JAPANESE_LARGE_BATCH,
  LLM_BATCH_CONCURRENCY,
  SOFTMAX_SCALE,
} from "./constants";
import type { ArticleWithTag } from "@/lib/types";

function getBatchSize(articles: ArticleWithTag[]): number {
  if (articles.length === 0) return LLM_BATCH_SIZE;
  const japaneseRatio =
    articles.filter((a) => /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(a.article.title))
      .length / articles.length;
  return japaneseRatio > JAPANESE_RATIO_THRESHOLD ? JAPANESE_LARGE_BATCH : LLM_BATCH_SIZE;
}

/** Group tagged articles by assigned keyword (including null-keyword articles
 *  which are below the tagging threshold), score each group in batches of
 *  LLM_BATCH_SIZE via LLM, and save. Returns count of LLM-scored (saved)
 *  articles. Null-keyword articles are still scored and saved for display. */
export async function scoreAndSaveTagged(tagged: ArticleWithTag[]): Promise<number> {
  // Normalize similarities using softmax (null-keyword articles are skipped from
  // normalization but included in results)
  const normalizedTagged = normalizeSimilaritiesWithTagged(tagged);

  // Separate tagged and untagged (below threshold) articles
  const taggedByKeyword = new Map<string, ArticleWithTag[]>();
  const untagged: ArticleWithTag[] = [];
  for (const t of normalizedTagged) {
    if (t.keyword === null) {
      untagged.push(t);
    } else {
      const list = taggedByKeyword.get(t.keyword);
      if (list) list.push(t);
      else taggedByKeyword.set(t.keyword, [t]);
    }
  }

  // Build batch list with pre-computed batch sizes (P6-b: compute once per group)
  const batches: { items: ArticleWithTag[]; keyword: string | null }[] = [];

  for (const [keyword, group] of taggedByKeyword) {
    const batchSize = getBatchSize(group);
    for (let start = 0; start < group.length; start += batchSize) {
      batches.push({ items: group.slice(start, start + batchSize), keyword });
    }
  }

  {
    const batchSize = getBatchSize(untagged);
    for (let start = 0; start < untagged.length; start += batchSize) {
      batches.push({ items: untagged.slice(start, start + batchSize), keyword: null });
    }
  }

  // Score and save all batches with concurrency limit (P6-a)
  const limit = pLimit(LLM_BATCH_CONCURRENCY);
  const counts = await Promise.all(
    batches.map((b) => limit(() => scoreAndSaveBatch(b.items, b.keyword))),
  );

  return counts.reduce((sum, c) => sum + c, 0);
}

/** Score a batch of articles via LLM and persist to DB. */
async function scoreAndSaveBatch(batch: ArticleWithTag[], keyword: string | null): Promise<number> {
  const llmResults = await scoreArticles(
    batch.map((t) => ({ title: t.article.title, description: t.article.description })),
  );

  // Build upsert list
  const upsertList = [];
  const llmSuccessUrls = new Set<string>();

  for (let i = 0; i < batch.length; i++) {
    const { article, embedding, similarity } = batch[i];
    const llmResult = llmResults[i] ?? null;
    const usefulness = llmResult?.usefulness ?? null;
    const recency = calcRecencyScore(article.publishedAt);
    const composite = calcCompositeScore(similarity, usefulness, recency);
    // similarity is already normalized to 0-10 by normalizeSimilaritiesWithTagged
    const relevance =
      Math.round(Math.max(0, Math.min(SOFTMAX_SCALE, similarity)) * SOFTMAX_SCALE) / SOFTMAX_SCALE;

    upsertList.push({
      title: article.title,
      description: article.description,
      url: article.url,
      urlToImage: article.urlToImage,
      publishedAt: article.publishedAt,
      sourceName: article.sourceName,
      sourceId: article.sourceId,
      author: article.author,
      keyword,
      summary: llmResult?.summary ?? null,
      relevance,
      usefulness,
      recency,
      score: composite,
      reason: llmResult?.reason ?? null,
      // Always mark the article as processed (attempted) so the UI polling
      // can detect completion even when the LLM fails for some articles.
      // `score` stays null for failed ones; completion is based on
      // `scoredAt` (processed), not on a successful score.
      scoredAt: new Date().toISOString(),
      recencyRefreshedAt: new Date().toISOString(),
      embedding: JSON.stringify(embedding),
    });

    if (llmResult) llmSuccessUrls.add(article.url);
  }

  // Batch upsert
  const result = await upsertArticles(upsertList);

  // Count articles that were both LLM-successful and upsert-successful
  let savedCount = 0;
  for (const url of result.succeeded) {
    if (llmSuccessUrls.has(url)) savedCount++;
  }

  // Log failures
  for (const url of result.failed) {
    const article = batch.find((a) => a.article.url === url);
    if (article) console.error(`[pipeline] Failed to save article "${article.article.title}"`);
  }

  return savedCount;
}
