import { db } from "./index";
import { articles } from "./schema";
import { desc, isNotNull } from "drizzle-orm";

export interface ArticleInsert {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  author: string | null;
  keyword: string;
  summary: string | null;
  score: number | null;
  reason: string | null;
  scoredAt: string | null;
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
          author: data.author,
          keyword: data.keyword,
          score: data.score,
          summary: data.summary,
          reason: data.reason,
          scoredAt: data.scoredAt,
        },
      });
  } catch (err) {
    console.warn(`[db] upsert error:`, err);
  }
}

/** Articles with LLM score, ordered by score then date. */
export async function getScoredArticles(limit = 50) {
  try {
    return await db
      .select()
      .from(articles)
      .where(isNotNull(articles.score))
      .orderBy(desc(articles.score), desc(articles.publishedAt))
      .limit(limit);
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
  }
}

/** All articles, newest first (for "last updated" timestamp). */
export async function getAllArticles(limit = 10) {
  try {
    return await db
      .select()
      .from(articles)
      .orderBy(desc(articles.createdAt))
      .limit(limit);
  } catch (err) {
    console.warn(`[db] query error:`, err);
    return [];
  }
}
