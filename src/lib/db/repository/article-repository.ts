import { db } from "../index";
import { articles } from "../schema";
import { and, lt, inArray, eq, notInArray, isNotNull } from "drizzle-orm";
import { calcRecencyScore } from "../../scoring";
import { DEFAULT_DELETE_LOW_SCORE, WEIGHT_RECENCY, SOFTMAX_SCALE } from "../../constants";

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
  contentHash?: string | null;
  scoringSignature?: string | null;
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
          contentHash: data.contentHash,
          scoringSignature: data.scoringSignature,
        },
      });
  } catch (err) {
    console.error(`[db] upsert error for url="${data.url}":`, err);
    throw err;
  }
}

/** Batch insert or update articles by URL. Returns { succeeded: urls[], failed: urls[] }. */
export async function upsertArticles(
  dataList: ArticleInsert[],
): Promise<{ succeeded: string[]; failed: string[] }> {
  if (dataList.length === 0) return { succeeded: [], failed: [] };

  try {
    // Try batch insert first
    try {
      const statements = dataList.map((data) =>
        db
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
            },
          }),
      );
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
      return {
        succeeded: dataList.map((d) => d.url),
        failed: [],
      };
    } catch (batchErr) {
      // Fallback: individual inserts
      console.warn(`[db] batch upsert failed, falling back to individual upserts:`, batchErr);
      const succeeded: string[] = [];
      const failed: string[] = [];

      for (const data of dataList) {
        try {
          await upsertArticle(data);
          succeeded.push(data.url);
        } catch (e) {
          console.error(`[db] failed to upsert article "${data.url}":`, e);
          failed.push(data.url);
        }
      }

      return { succeeded, failed };
    }
  } catch (err) {
    console.error(`[db] upsertArticles error:`, err);
    return {
      succeeded: [],
      failed: dataList.map((d) => d.url),
    };
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

/** Delete stale low-scored articles older than retentionDays (tombstone GC). */
export async function deleteStaleLowScored(minScore: number, retentionDays: number): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    await db
      .delete(articles)
      .where(
        and(
          isNotNull(articles.score),
          lt(articles.score, minScore),
          lt(articles.publishedAt, cutoff),
        ),
      );
  } catch (err) {
    console.warn(`[db] deleteStaleLowScored error:`, err);
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

    // Calculate updates upfront
    const updates: Array<{
      url: string;
      recency: number;
      score: number;
      recencyRefreshedAt: string;
    }> = [];
    for (const article of targetArticles) {
      if (article.score === null) continue;

      const oldRecency = article.recency ?? 0;
      const newRecency = calcRecencyScore(article.publishedAt);
      const delta = (newRecency - oldRecency) * WEIGHT_RECENCY;
      const newScore =
        Math.round(Math.max(0, Math.min(SOFTMAX_SCALE, article.score + delta)) * SOFTMAX_SCALE) /
        SOFTMAX_SCALE;

      updates.push({
        url: article.url,
        recency: newRecency,
        score: newScore,
        recencyRefreshedAt: new Date().toISOString(),
      });
    }

    if (updates.length === 0) return 0;

    // Try batch update first
    try {
      const statements = updates.map((u) =>
        db
          .update(articles)
          .set({
            recency: u.recency,
            score: u.score,
            recencyRefreshedAt: u.recencyRefreshedAt,
          })
          .where(eq(articles.url, u.url)),
      );
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
      return updates.length;
    } catch (batchErr) {
      // Fallback: individual updates
      console.warn(`[db] batch refresh failed, falling back to individual updates:`, batchErr);
      let successCount = 0;
      for (const u of updates) {
        try {
          await db
            .update(articles)
            .set({
              recency: u.recency,
              score: u.score,
              recencyRefreshedAt: u.recencyRefreshedAt,
            })
            .where(eq(articles.url, u.url));
          successCount++;
        } catch (e) {
          console.error(`[db] failed to update article "${u.url}":`, e);
        }
      }
      return successCount;
    }
  } catch (err) {
    console.error(`[db] refreshRecencyForSources error:`, err);
    return 0;
  }
}
