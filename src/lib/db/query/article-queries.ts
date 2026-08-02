import { db } from "../index";
import { articles, keywordEmbeddings, favorites } from "../schema";
import { desc, asc, isNotNull, inArray, eq, sql, and } from "drizzle-orm";
import { DEFAULT_SCORED_ARTICLES_LIMIT, DEFAULT_ALL_ARTICLES_LIMIT } from "../../constants";
import { getAllowedSortColumns } from "@/app/admin/db/lib/table-config";
import { unstable_cache } from "next/cache";
import { resolveKeywordLabel } from "../../config";

/** Display-safe columns for article list (excludes embedding, description, and other unused fields). */
export const ARTICLE_LIST_COLUMNS = {
  id: articles.id,
  title: articles.title,
  url: articles.url,
  publishedAt: articles.publishedAt,
  sourceName: articles.sourceName,
  sourceId: articles.sourceId,
  keyword: articles.keyword,
  summary: articles.summary,
  relevance: articles.relevance,
  usefulness: articles.usefulness,
  recency: articles.recency,
  score: articles.score,
  reason: articles.reason,
} as const;

export type ArticleListRow = Awaited<ReturnType<typeof getScoredArticles>>[number];

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
    const rows = await db
      .select(ARTICLE_LIST_COLUMNS)
      .from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.score), desc(articles.publishedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, keywordLabel: resolveKeywordLabel(r.keyword) }));
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
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

export type TableName = "articles" | "keyword_embeddings" | "favorites";

export interface TablePageOptions {
  table: TableName;
  offset: number;
  limit: number;
  sort?: string;
  dir?: "asc" | "desc";
}

const tableMap = {
  articles,
  keyword_embeddings: keywordEmbeddings,
  favorites,
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

    // Get rows with pagination and sorting securely using record lookup or explicit type checking
    const colsRecord = tableObj as Record<string, any>;
    const colRef = colsRecord[sortCol] ?? colsRecord.id;

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

async function countRows(tableObj: any): Promise<number> {
  try {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(tableObj);
    return Number(result?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function getTableCounts(): Promise<Record<TableName, number>> {
  const [articlesCount, embeddingsCount, favoritesCount] = await Promise.all([
    countRows(articles),
    countRows(keywordEmbeddings),
    countRows(favorites),
  ]);

  return {
    articles: articlesCount,
    keyword_embeddings: embeddingsCount,
    favorites: favoritesCount,
  };
}

export const getScoredArticlesCached = unstable_cache(
  async (limit?: number, sourceIds?: string[] | string) => getScoredArticles(limit, sourceIds),
  ["scored-articles"],
  { tags: ["articles"], revalidate: 300 },
);
