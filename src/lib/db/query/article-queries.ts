import { db } from "../index";
import { articles, favorites, notForMe, preferenceProfiles } from "../schema";
import { desc, asc, isNotNull, gte, inArray, eq, sql, and, type SQL } from "drizzle-orm";
import {
  DEFAULT_SCORED_ARTICLES_LIMIT,
  DEFAULT_ALL_ARTICLES_LIMIT,
  DISPLAY_MIN_SCORE,
} from "../../constants";
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
    const conditions = [isNotNull(articles.score), gte(articles.score, DISPLAY_MIN_SCORE)];
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

export interface ScoringState {
  url: string;
  contentHash: string | null;
  scoringSignature: string | null;
  scoredAt: string | null;
  score: number | null;
}

/** Fetch scoring state for URLs. Chunked in 200 to stay under SQLite bind-var limits. */
export async function getScoringStateByUrls(urls: string[]): Promise<Map<string, ScoringState>> {
  const map = new Map<string, ScoringState>();
  if (urls.length === 0) return map;
  try {
    const CHUNK = 200;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      const rows = await db
        .select({
          url: articles.url,
          contentHash: articles.contentHash,
          scoringSignature: articles.scoringSignature,
          scoredAt: articles.scoredAt,
          score: articles.score,
        })
        .from(articles)
        .where(inArray(articles.url, chunk));
      for (const row of rows) map.set(row.url, row);
    }
    return map;
  } catch (err) {
    console.warn(`[db] getScoringStateByUrls error:`, err);
    return map;
  }
}

export type TableName = "articles" | "favorites" | "not_for_me" | "preference_profiles";

export type ArticleRow = typeof articles.$inferSelect;
export type FavoriteRow = typeof favorites.$inferSelect;
export type NotForMeRow = typeof notForMe.$inferSelect;
export type PreferenceProfileRow = typeof preferenceProfiles.$inferSelect;

export type TableRowMap = {
  articles: ArticleRow;
  favorites: FavoriteRow;
  not_for_me: NotForMeRow;
  preference_profiles: PreferenceProfileRow;
};

export interface TablePageOptions {
  offset: number;
  limit: number;
  sort?: string;
  dir?: "asc" | "desc";
}

const tableMap = {
  articles,
  favorites,
  not_for_me: notForMe,
  preference_profiles: preferenceProfiles,
} as const;

export async function getTablePage<T extends TableName>(
  table: T,
  options: TablePageOptions,
): Promise<{ rows: TableRowMap[T][]; total: number }> {
  try {
    const tableObj = tableMap[table];
    if (!tableObj) {
      return { rows: [], total: 0 };
    }

    const allowedSort = getAllowedSortColumns(table);
    const sortCol = options.sort && allowedSort.includes(options.sort) ? options.sort : "id";
    const sortDir = options.dir === "asc" ? asc : desc;

    // Get total count (reuse countRows to avoid duplication)
    const total = await countRows(tableObj);

    // Get rows with pagination and sorting securely using record lookup or explicit type checking
    const colsRecord = tableObj as unknown as Record<string, unknown>;
    const colRef = colsRecord[sortCol] ?? colsRecord.id;

    const rows = await db
      .select()
      .from(tableObj)
      .orderBy(sortDir(colRef as SQL))
      .limit(Math.min(options.limit, 200))
      .offset(options.offset);

    return { rows: rows as TableRowMap[T][], total };
  } catch (err) {
    console.warn(`[db] getTablePage error for table=${table}:`, err);
    return { rows: [], total: 0 };
  }
}

async function countRows(tableObj: (typeof tableMap)[TableName]): Promise<number> {
  try {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(tableObj);
    return Number(result?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function getTableCounts(): Promise<Record<TableName, number>> {
  const [articlesCount, favoritesCount, notForMeCount, preferenceProfilesCount] = await Promise.all(
    [countRows(articles), countRows(favorites), countRows(notForMe), countRows(preferenceProfiles)],
  );

  return {
    articles: articlesCount,
    favorites: favoritesCount,
    not_for_me: notForMeCount,
    preference_profiles: preferenceProfilesCount,
  };
}

export const getScoredArticlesCached = unstable_cache(
  async (limit?: number, sourceIds?: string[] | string) => getScoredArticles(limit, sourceIds),
  ["scored-articles"],
  { tags: ["articles"], revalidate: 300 },
);
