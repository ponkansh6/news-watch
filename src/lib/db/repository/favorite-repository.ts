import { db } from "../index";
import { articles, favorites } from "../schema";
import { eq, desc } from "drizzle-orm";
import { ARTICLE_LIST_COLUMNS, type ArticleListRow } from "../query/article-queries";
import { unstable_cache } from "next/cache";
import { resolveKeywordLabel } from "../../config";

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
export async function getFavoriteArticles(): Promise<ArticleListRow[]> {
  try {
    const rows = await db
      .select(ARTICLE_LIST_COLUMNS)
      .from(articles)
      .innerJoin(favorites, eq(articles.id, favorites.articleId))
      .orderBy(desc(favorites.createdAt));

    return rows.map((r) => ({
      ...r,
      keywordLabel: resolveKeywordLabel(r.keyword),
    })) as ArticleListRow[];
  } catch (err) {
    console.warn(`[db] getFavoriteArticles error:`, err);
    return [];
  }
}

export const getFavoriteArticlesCached = unstable_cache(
  async () => getFavoriteArticles(),
  ["favorite-articles"],
  { tags: ["favorites"], revalidate: 300 },
);
