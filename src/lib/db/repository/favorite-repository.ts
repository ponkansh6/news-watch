import { db } from "../index";
import { articles, favorites } from "../schema";
import { eq, desc } from "drizzle-orm";
import type { ArticleInsert } from "./article-repository";

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
