import { db } from "./index";
import { articles } from "./schema";
import { desc, isNotNull, notInArray, and, lt, inArray } from "drizzle-orm";

export interface ArticleInsert {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string | null;
  author: string | null;
  keyword: string;
  summary: string | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
  reason: string | null;
  scoredAt: string | null;
  score: number | null;
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
          summary: data.summary,
          reason: data.reason,
          scoredAt: data.scoredAt,
          score: data.score,
        },
      });
  } catch (err) {
    console.warn(`[db] upsert error:`, err);
  }
}

/** Articles with composite score, ordered by score then date. */
export async function getScoredArticles(limit = 50, sourceIds?: string[]) {
  try {
    const conditions = [isNotNull(articles.score)];
    if (sourceIds && sourceIds.length > 0) {
      conditions.push(inArray(articles.sourceId, sourceIds));
    }
    return await db
      .select()
      .from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.score), desc(articles.publishedAt))
      .limit(limit);
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
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
export async function deleteLowScoredArticles(minScore = 5) {
  try {
    return await db
      .delete(articles)
      .where(and(isNotNull(articles.score), lt(articles.score, minScore)));
  } catch (err) {
    console.warn(`[db] delete low-score error:`, err);
  }
}

/** All articles, newest first (for "last updated" timestamp). */
export async function getAllArticles(limit = 10) {
  try {
    return await db.select().from(articles).orderBy(desc(articles.createdAt)).limit(limit);
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
  }
}
