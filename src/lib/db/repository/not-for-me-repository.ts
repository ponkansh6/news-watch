import { db } from "../index";
import { articles, notForMe } from "../schema";
import { eq, desc, sql } from "drizzle-orm";
import { ARTICLE_LIST_COLUMNS, type ArticleListRow } from "../query/article-queries";
import { resolveKeywordLabel } from "../../config";

/** Toggle not-for-me status for an article. Returns the new state (true = registered as not-for-me). */
export async function toggleNotForMe(articleId: number): Promise<boolean> {
  try {
    const existing = await db
      .select({ id: notForMe.id })
      .from(notForMe)
      .where(eq(notForMe.articleId, articleId))
      .limit(1);

    if (existing.length > 0) {
      await db.delete(notForMe).where(eq(notForMe.id, existing[0].id));
      return false;
    } else {
      await db.insert(notForMe).values({ articleId });
      return true;
    }
  } catch (err) {
    console.error(`[db] toggleNotForMe error for articleId=${articleId}:`, err);
    throw err;
  }
}

/** Get full article data for all not-for-me articles. */
export async function getNotForMeArticles(): Promise<ArticleListRow[]> {
  try {
    const rows = await db
      .select(ARTICLE_LIST_COLUMNS)
      .from(articles)
      .innerJoin(notForMe, eq(articles.id, notForMe.articleId))
      .orderBy(desc(notForMe.createdAt));

    return rows.map((r) => ({
      ...r,
      keywordLabel: resolveKeywordLabel(r.keyword),
    })) as ArticleListRow[];
  } catch (err) {
    console.warn(`[db] getNotForMeArticles error:`, err);
    return [];
  }
}

/** Not-for-me count and max not-for-me id (for cooldown/change detection). */
export async function getNotForMeStats(): Promise<{ count: number; maxId: number }> {
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)`,
        maxId: sql<number>`coalesce(max(${notForMe.id}), 0)`,
      })
      .from(notForMe);
    return { count: Number(row?.count ?? 0), maxId: Number(row?.maxId ?? 0) };
  } catch (err) {
    console.warn(`[db] getNotForMeStats error:`, err);
    return { count: 0, maxId: 0 };
  }
}
