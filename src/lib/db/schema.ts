import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Scored news articles.
 * - url is unique for deduplication (auto-indexed by UNIQUE).
 * - Query pattern: WHERE score IS NOT NULL ORDER BY score DESC, publishedAt DESC.
 * - getAllArticles queries: ORDER BY createdAt DESC.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull().unique(),
    urlToImage: text("url_to_image"),
    publishedAt: text("published_at").notNull(),
    sourceName: text("source_name"),
    author: text("author"),
    keyword: text("keyword").notNull(),
    summary: text("summary"),
    score: real("score"),
    reason: text("reason"),
    scoredAt: text("scored_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    keywordIdx: index("idx_keyword").on(table.keyword),
    scorePubIdx: index("idx_score_pub").on(table.score, table.publishedAt),
    createdAtIdx: index("idx_created_at").on(table.createdAt),
  }),
);
