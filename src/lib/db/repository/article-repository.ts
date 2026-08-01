import { db } from "../index";
import { articles } from "../schema";
import { and, lt, inArray, eq, notInArray, isNotNull, desc } from "drizzle-orm";
import { calcRecencyScore } from "../../scoring";
import {
  DEFAULT_SCORED_ARTICLES_LIMIT,
  DEFAULT_DELETE_LOW_SCORE,
  DEFAULT_ALL_ARTICLES_LIMIT,
  WEIGHT_RECENCY,
  SOFTMAX_SCALE,
} from "../../constants";

export interface ArticleInsert {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string | null;
  author: string | null;
  keyword: string | null;
  summary: string | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
  recencyRefreshedAt?: string | null;
  reason: string | null;
  scoredAt: string | null;
  score: number | null;
  embedding: string | null;
}

/** Insert or update article by URL. On conflict, refresh score/summary/reason. */
export async function upsertArticle(data: ArticleInsert) {
  try {
    await db
      .insert(articles)
      .values(data)
      .onConflictDoUpdate({
        target: articles.url,
        set: {
          title: data.title,
          description: data.description,
          urlToImage: data.urlToImage,
          publishedAt: data.publishedAt,
          sourceName: data.sourceName,
          sourceId: data.sourceId,
          author: data.author,
          keyword: data.keyword,
          relevance: data.relevance,
          usefulness: data.usefulness,
          recency: data.recency,
          recencyRefreshedAt: data.recencyRefreshedAt,
          summary: data.summary,
          reason: data.reason,
          scoredAt: data.scoredAt,
          score: data.score,
          embedding: data.embedding,
        },
      });
  } catch (err) {
    console.error(`[db] upsert error for url="${data.url}":`, err);
    throw err;
  }
}

/** Delete articles whose keyword is not in the active set. */
export async function deleteOrphanedArticles(activeKeywords: string[]) {
  try {
    const result = await db.delete(articles).where(notInArray(articles.keyword, activeKeywords));
    return result;
  } catch (err) {
    console.warn(`[db] delete error:`, err);
  }
}

/** Delete articles with composite score below minScore. */
export async function deleteLowScoredArticles(minScore = DEFAULT_DELETE_LOW_SCORE, since?: string) {
  try {
    const conditions = [isNotNull(articles.score), lt(articles.score, minScore)];
    if (since) conditions.push(lt(articles.scoredAt, since));
    return await db.delete(articles).where(and(...conditions));
  } catch (err) {
    console.warn(`[db] delete low-score error:`, err);
  }
}

/** Refresh recency and update score for existing articles in sources. */
export async function refreshRecencyForSources(
  sourceIds: string[],
  excludeUrls: string[],
): Promise<number> {
  try {
    const targetArticles = await db
      .select({
        url: articles.url,
        recency: articles.recency,
        score: articles.score,
        publishedAt: articles.publishedAt,
      })
      .from(articles)
      .where(and(inArray(articles.sourceId, sourceIds), notInArray(articles.url, excludeUrls)));

    let updatedCount = 0;
    // Batch or individual updates maintaining identical result behavior
    for (const article of targetArticles) {
      if (article.score === null) continue;

      const oldRecency = article.recency ?? 0;
      const newRecency = calcRecencyScore(article.publishedAt);
      const delta = (newRecency - oldRecency) * WEIGHT_RECENCY;
      const newScore =
        Math.round(Math.max(0, Math.min(SOFTMAX_SCALE, article.score + delta)) * SOFTMAX_SCALE) /
        SOFTMAX_SCALE;

      await db
        .update(articles)
        .set({
          recency: newRecency,
          score: newScore,
          recencyRefreshedAt: new Date().toISOString(),
        })
        .where(eq(articles.url, article.url));
      updatedCount++;
    }
    return updatedCount;
  } catch (err) {
    console.error(`[db] refreshRecencyForSources error:`, err);
    return 0;
  }
}
