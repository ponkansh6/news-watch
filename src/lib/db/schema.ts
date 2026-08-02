import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { EMBEDDING_DIMENSIONS } from "../constants";

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
    keyword: text("keyword"),
    summary: text("summary"),
    relevance: real("relevance"),
    usefulness: real("usefulness"),
    recency: real("recency"),
    recencyRefreshedAt: text("recency_refreshed_at"),
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
    sourceScorePubIdx: index("idx_source_score_pub").on(
      table.sourceId,
      table.score,
      table.publishedAt,
    ),
    createdAtIdx: index("idx_created_at").on(table.createdAt),
  }),
);

export const keywordEmbeddings = sqliteTable("keyword_embeddings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  keyword: text("keyword").notNull().unique(),
  embedding: text("embedding").notNull(),
  model: text("model").notNull().default("gemini-embedding-2"),
  dimensions: integer("dimensions").notNull().default(EMBEDDING_DIMENSIONS),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Hidden favorites (unofficial feature).
 * - article_id is unique (one favorite per article, toggle on/off).
 * - No visitor ID — shared global list for a limited group of users.
 * - Trigger: 5 rapid clicks on the reason (AI evaluation comment) span.
 */
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueArticle: uniqueIndex("favorites_article_id_unique").on(table.articleId),
  }),
);
