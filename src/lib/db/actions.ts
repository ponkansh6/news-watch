import { db } from "./index";
import { articles, keywordEmbeddings, favorites } from "./schema";
import { desc, asc, isNotNull, notInArray, and, lt, inArray, eq, sql } from "drizzle-orm";
import { calcRecencyScore } from "../scoring";
import { getAllowedSortColumns } from "@/app/admin/db/lib/table-config";
import {
  DEFAULT_SCORED_ARTICLES_LIMIT,
  DEFAULT_DELETE_LOW_SCORE,
  DEFAULT_ALL_ARTICLES_LIMIT,
  WEIGHT_RECENCY,
  SOFTMAX_SCALE,
} from "../constants";

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

/** Articles with composite score, ordered by score then date. */
export async function getScoredArticles(
  limit = DEFAULT_SCORED_ARTICLES_LIMIT,
  sourceIds?: string[] | string,
) {
  try {
    const conditions = [isNotNull(articles.score)];
    if (sourceIds) {
      if (Array.isArray(sourceIds) && sourceIds.length > 0) {
        conditions.push(inArray(articles.sourceId, sourceIds));
      } else if (typeof sourceIds === "string") {
        conditions.push(eq(articles.sourceId, sourceIds));
      }
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
export async function deleteLowScoredArticles(minScore = DEFAULT_DELETE_LOW_SCORE, since?: string) {
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
export async function getAllArticles(limit = DEFAULT_ALL_ARTICLES_LIMIT) {
  try {
    return await db.select().from(articles).orderBy(desc(articles.createdAt)).limit(limit);
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
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

export type TableName = "articles" | "keyword_embeddings";

export interface TablePageOptions {
  table: TableName;
  offset: number;
  limit: number; // max 200
  sort?: string; // column name to sort by
  dir?: "asc" | "desc";
}

const tableMap = {
  articles,
  keyword_embeddings: keywordEmbeddings,
} as const;

export async function getTablePage<T extends TableName>(
  table: T,
  options: TablePageOptions,
): Promise<{ rows: any[]; total: number }> {
  try {
    const tableObj = tableMap[table];
    if (!tableObj) {
      return { rows: [], total: 0 };
    }

    const allowedSort = getAllowedSortColumns(table);
    const sortCol = options.sort && allowedSort.includes(options.sort) ? options.sort : "id";
    const sortDir = options.dir === "asc" ? asc : desc;

    // Get total count
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(tableObj);
    const total = Number(countResult?.count ?? 0);

    // Get rows with pagination and sorting
    // @ts-expect-error dynamic column sorting
    const colRef = tableObj[sortCol] ?? tableObj.id;

    const rows = await db
      .select()
      .from(tableObj)
      .orderBy(sortDir(colRef))
      .limit(Math.min(options.limit, 200))
      .offset(options.offset);

    return { rows, total };
  } catch (err) {
    console.warn(`[db] getTablePage error for table=${table}:`, err);
    return { rows: [], total: 0 };
  }
}

async function countRows(tableObj: any, label: string): Promise<number> {
  try {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(tableObj);
    return Number(result?.count ?? 0);
  } catch {
    // Table may not exist (test env, migration drift, etc.)
    return 0;
  }
}

export async function getTableCounts(): Promise<Record<TableName, number>> {
  const [articlesCount, embeddingsCount] = await Promise.all([
    countRows(articles, "articles"),
    countRows(keywordEmbeddings, "keyword_embeddings"),
  ]);

  return {
    articles: articlesCount,
    keyword_embeddings: embeddingsCount,
  };
}

// ── Favorites (hidden unofficial feature) ────────────────────────────────

/** Toggle favorite status for an article. Returns the new state (true = favorited). */
export async function toggleFavorite(articleId: number): Promise<boolean> {
  try {
    const existing = await db
      .select({ id: favorites.id })
      .from(favorites)
      .where(eq(favorites.articleId, articleId))
      .limit(1);

    if (existing.length > 0) {
      await db.delete(favorites).where(eq(favorites.id, existing[0].id));
      return false;
    } else {
      await db.insert(favorites).values({ articleId });
      return true;
    }
  } catch (err) {
    console.error(`[db] toggleFavorite error for articleId=${articleId}:`, err);
    throw err;
  }
}

/** Get all favorited article IDs. */
export async function getFavoriteIds(): Promise<number[]> {
  try {
    const rows = await db
      .select({ articleId: favorites.articleId })
      .from(favorites)
      .orderBy(desc(favorites.createdAt));
    return rows.map((r) => r.articleId);
  } catch (err) {
    console.warn(`[db] getFavoriteIds error:`, err);
    return [];
  }
}

/** Get full article data for all favorited articles. */
export async function getFavoriteArticles(): Promise<ArticleInsert[]> {
  try {
    const rows = await db
      .select()
      .from(articles)
      .innerJoin(favorites, eq(articles.id, favorites.articleId))
      .orderBy(desc(favorites.createdAt));

    return rows.map((r) => ({
      title: r.articles.title,
      description: r.articles.description,
      url: r.articles.url,
      urlToImage: r.articles.urlToImage,
      publishedAt: r.articles.publishedAt,
      sourceName: r.articles.sourceName,
      sourceId: r.articles.sourceId,
      author: r.articles.author,
      keyword: r.articles.keyword,
      summary: r.articles.summary,
      relevance: r.articles.relevance,
      usefulness: r.articles.usefulness,
      recency: r.articles.recency,
      recencyRefreshedAt: r.articles.recencyRefreshedAt,
      reason: r.articles.reason,
      scoredAt: r.articles.scoredAt,
      score: r.articles.score,
      embedding: r.articles.embedding,
    }));
  } catch (err) {
    console.warn(`[db] getFavoriteArticles error:`, err);
    return [];
  }
}
