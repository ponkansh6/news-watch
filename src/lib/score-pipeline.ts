import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import type { ArticleWithTag } from "@/lib/vector-filter";

/** Max articles sent to the LLM in a single scoring request. */
const LLM_BATCH_SIZE = 20;

/** Group tagged articles by assigned keyword, score each group in batches of
 *  LLM_BATCH_SIZE via LLM, and save. Returns count of LLM-scored (saved) articles. */
export async function scoreAndSaveTagged(tagged: ArticleWithTag[]): Promise<number> {
  const byKeyword = new Map<string, ArticleWithTag[]>();
  for (const t of tagged) {
    const list = byKeyword.get(t.keyword);
    if (list) list.push(t);
    else byKeyword.set(t.keyword, [t]);
  }

  let savedCount = 0;
  for (const [keyword, group] of byKeyword) {
    // Split the group into batches of LLM_BATCH_SIZE
    for (let start = 0; start < group.length; start += LLM_BATCH_SIZE) {
      const batch = group.slice(start, start + LLM_BATCH_SIZE);
      const llmResults = await scoreArticles(
        batch.map((t) => ({ title: t.article.title, description: t.article.description })),
      );
      for (let i = 0; i < batch.length; i++) {
        const { article, embedding, similarity } = batch[i];
        const llmResult = llmResults[i] ?? null;
        const usefulness = llmResult?.usefulness ?? null;
        const recency = calcRecencyScore(article.publishedAt);
        const composite = calcCompositeScore(similarity, usefulness, recency);
        // Normalize similarity (0-1) to relevance (0-10), same as calcCompositeScore
        const relevance = Math.round(Math.max(0, Math.min(1, similarity)) * 10 * 10) / 10;
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
          // Only count articles that were actually persisted to the DB.
          // Previously this was outside the try-catch, causing the UI to
          // show "N件スコアリング完了" even when all DB writes failed.
          if (llmResult) savedCount++;
        } catch (err) {
          console.error(`[pipeline] Failed to save article "${article.title}":`, err);
          // Continue processing other articles even if one fails
        }
      }
    }
  }
  return savedCount;
}
