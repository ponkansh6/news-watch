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
    sourceId: text("source_id"),
    author: text("author"),
    keyword: text("keyword").notNull(),
    summary: text("summary"),
    relevance: real("relevance"),
    usefulness: real("usefulness"),
    recency: real("recency"),
    reason: text("reason"),
    scoredAt: text("scored_at"),
    score: real("score"),
    embedding: text("embedding"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    keywordIdx: index("idx_keyword").on(table.keyword),
    relevancePubIdx: index("idx_relevance_pub").on(table.relevance, table.publishedAt),
    recencyPubIdx: index("idx_recency_pub").on(table.recency, table.publishedAt),
    createdAtIdx: index("idx_created_at").on(table.createdAt),
  }),
);

export const keywordEmbeddings = sqliteTable("keyword_embeddings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  keyword: text("keyword").notNull().unique(),
  embedding: text("embedding").notNull(),
  model: text("model").notNull().default("gemini-embedding-2"),
  dimensions: integer("dimensions").notNull().default(768),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
