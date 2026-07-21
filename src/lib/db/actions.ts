import { db } from "./index";
import { articles, hatenaFeeds } from "./schema";
import { desc, isNotNull, notInArray, and, lt, inArray, eq } from "drizzle-orm";
import { calcRecencyScore } from "../scoring";

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
export async function deleteLowScoredArticles(minScore = 5, since?: string) {
  try {
    const conditions = [isNotNull(articles.score), lt(articles.score, minScore)];
    // Protect the current fetch batch: only delete articles scored before
    // `since`. Articles scored in the current fetch (scoredAt >= since) are
    // kept so the UI polling count (processed) stays consistent with fetched.
    if (since) conditions.push(lt(articles.scoredAt, since));
    return await db.delete(articles).where(and(...conditions));
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

/** Get all Hatena feeds, ordered by error count (desc) then last fetched (desc). */
export async function getHatenaFeeds() {
  try {
    return await db
      .select()
      .from(hatenaFeeds)
      .orderBy(desc(hatenaFeeds.errorCount), desc(hatenaFeeds.lastFetchedAt));
  } catch (err) {
    console.warn(`[db] getHatenaFeeds error:`, err);
    return [];
  }
}

/** Reactivate a Hatena feed by ID. */
export async function reactivateHatenaFeed(id: number) {
  try {
    const result = await db
      .update(hatenaFeeds)
      .set({
        status: "active",
        errorCount: 0,
        lastError: null,
      })
      .where(eq(hatenaFeeds.id, id));
    return result.rowsAffected > 0;
  } catch (err) {
    console.error(`[db] reactivateHatenaFeed error for id=${id}:`, err);
    return false;
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
    for (const article of targetArticles) {
      if (article.score === null) continue;

      const oldRecency = article.recency ?? 0;
      const newRecency = calcRecencyScore(article.publishedAt);
      const delta = (newRecency - oldRecency) * 0.3;
      const newScore = Math.round(Math.max(0, Math.min(10, article.score + delta)) * 10) / 10;

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
