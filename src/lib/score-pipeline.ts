import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import {
  calcRecencyScore,
  calcCompositeScore,
  normalizeSimilaritiesWithTagged,
} from "@/lib/scoring";
import type { ArticleWithTag } from "@/lib/types";

/** Max articles sent to the LLM in a single scoring request. */
const LLM_BATCH_SIZE = 20;

function getBatchSize(articles: ArticleWithTag[]): number {
  if (articles.length === 0) return LLM_BATCH_SIZE;
  const japaneseRatio =
    articles.filter((a) => /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(a.article.title))
      .length / articles.length;
  return japaneseRatio > 0.5 ? 8 : LLM_BATCH_SIZE;
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

  let savedCount = 0;

  // Score and save keyword-grouped articles
  for (const [keyword, group] of taggedByKeyword) {
    for (let start = 0; start < group.length; ) {
      const batchSize = getBatchSize(group.slice(start));
      const batch = group.slice(start, start + batchSize);
      savedCount += await scoreAndSaveBatch(batch, keyword);
      start += batchSize;
    }
  }

  // Score and save untagged articles (below threshold, keyword=null)
  for (let start = 0; start < untagged.length; ) {
    const batchSize = getBatchSize(untagged.slice(start));
    const batch = untagged.slice(start, start + batchSize);
    savedCount += await scoreAndSaveBatch(batch, null);
    start += batchSize;
  }

  return savedCount;
}

/** Score a batch of articles via LLM and persist to DB. */
async function scoreAndSaveBatch(batch: ArticleWithTag[], keyword: string | null): Promise<number> {
  const llmResults = await scoreArticles(
    batch.map((t) => ({ title: t.article.title, description: t.article.description })),
  );
  let savedCount = 0;
  for (let i = 0; i < batch.length; i++) {
    const { article, embedding, similarity } = batch[i];
    const llmResult = llmResults[i] ?? null;
    const usefulness = llmResult?.usefulness ?? null;
    const recency = calcRecencyScore(article.publishedAt);
    const composite = calcCompositeScore(similarity, usefulness, recency);
    // similarity is already normalized to 0-10 by normalizeSimilaritiesWithTagged
    const relevance = Math.round(Math.max(0, Math.min(10, similarity)) * 10) / 10;
    try {
      await upsertArticle({
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
      if (llmResult) savedCount++;
    } catch (err) {
      console.error(`[pipeline] Failed to save article "${article.title}":`, err);
    }
  }
  return savedCount;
}
