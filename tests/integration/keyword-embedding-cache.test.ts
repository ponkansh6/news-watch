import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

const mockBatchEmbed = vi.fn();
const mockCosineSimilarity = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  batchEmbed: (...args: any[]) => mockBatchEmbed(...args),
  cosineSimilarity: (...args: any[]) => mockCosineSimilarity(...args),
  EMBEDDING_MODEL_VERSION: "gemini-embedding-2",
  EMBEDDING_DIMENSIONS: 768,
}));

const mockScoreArticles = vi.fn();
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
}));

import * as dbMod from "@/lib/db";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import type { NormalizedArticle } from "@/lib/types";

function makeArticles(count: number): NormalizedArticle[] {
  return Array.from({ length: count }).map((_, i) => ({
    title: `記事 ${i}`,
    description: `説明 ${i}`,
    url: `http://test.com/a/${i}`,
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Test",
    sourceId: "gnews",
    author: "A",
  }));
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT NOT NULL UNIQUE,
      url_to_image TEXT,
      published_at TEXT NOT NULL,
      source_name TEXT,
      source_id TEXT,
      author TEXT,
      keyword TEXT NOT NULL,
      summary TEXT,
      relevance REAL,
      usefulness REAL,
      recency REAL,
      recency_refreshed_at TEXT,
      reason TEXT,
      scored_at TEXT,
      score REAL,
      embedding TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
  await (dbMod as any).__client.execute(`
    CREATE TABLE IF NOT EXISTS keyword_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      embedding TEXT NOT NULL,
      model TEXT DEFAULT 'gemini-embedding-2' NOT NULL,
      dimensions INTEGER DEFAULT 768 NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  await (dbMod as any).__client.execute("DELETE FROM keyword_embeddings");
  mockBatchEmbed.mockReset();
  mockCosineSimilarity.mockImplementation(() => 0.9);
});

describe("keyword embedding DB cache", () => {
  it("first run embeds keywords + articles and persists keyword embeddings", async () => {
    mockBatchEmbed.mockImplementation((items: any[]) =>
      Promise.resolve(items.map(() => new Array(768).fill(0.1))),
    );
    const articles = makeArticles(3);
    await tagArticlesByKeyword(articles, KEYWORDS);

    expect(mockBatchEmbed).toHaveBeenCalledTimes(1);
    const items = mockBatchEmbed.mock.calls[0][0];
    expect(items.length).toBe(KEYWORDS.length + 3);

    const rows = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM keyword_embeddings",
    );
    expect(rows.rows[0].cnt).toBe(KEYWORDS.length);
  });

  it("second run with cached keywords + cached articles makes 0 embedding requests", async () => {
    mockBatchEmbed.mockImplementation((items: any[]) =>
      Promise.resolve(items.map(() => new Array(768).fill(0.1))),
    );
    const articles = makeArticles(3);

    // First run populates caches
    await tagArticlesByKeyword(articles, KEYWORDS);
    mockBatchEmbed.mockClear();

    // Persist article embeddings (simulating what upsertArticle does)
    for (const a of articles) {
      await (dbMod as any).__client.execute({
        sql: "INSERT INTO articles (title, description, url, published_at, source_name, source_id, author, keyword, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          a.title,
          a.description,
          a.url,
          a.publishedAt,
          a.sourceName,
          a.sourceId,
          a.author,
          KEYWORDS[0],
          JSON.stringify(new Array(768).fill(0.1)),
        ],
      });
    }

    // Second run: all keywords + articles cached → 0 requests
    await tagArticlesByKeyword(articles, KEYWORDS);
    expect(mockBatchEmbed).toHaveBeenCalledTimes(0);
  });
});
