import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// インメモリ client をモックファクトリ内で生成し、テストから操作できるよう公開する
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

import * as dbMod from "@/lib/db";
import * as schemaMod from "../../src/lib/db/schema";
import {
  upsertArticle,
  toggleFavorite,
  getFavoriteIds,
  getFavoriteArticles,
} from "../../src/lib/db";

const CREATE_ARTICLES_SQL = `
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
`;

const CREATE_FAVORITES_SQL = `
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_SQL);
  await (dbMod as any).__client.execute(CREATE_FAVORITES_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM favorites");
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

describe("Favorites database actions", () => {
  it("toggleFavorite adds when not exists and removes when exists", async () => {
    // Insert an article first with explicit id or let it auto-increment to 1
    await upsertArticle({
      title: "Fav Test",
      description: null,
      url: "https://example.com/fav1",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "test",
      summary: "summary",
      relevance: 9,
      usefulness: 9,
      recency: 9,
      reason: "Great reasoning",
      scoredAt: "2026-01-01T00:00:00Z",
      score: 9,
      embedding: null,
    });

    // Get the inserted article ID
    const all = await dbMod.db.select().from(schemaMod.articles);
    const articleId = all[0].id;

    // Toggle on (should return true)
    const res1 = await toggleFavorite(articleId);
    expect(res1).toBe(true);

    const ids1 = await getFavoriteIds();
    expect(ids1).toEqual([articleId]);

    // Toggle off (should return false)
    const res2 = await toggleFavorite(articleId);
    expect(res2).toBe(false);

    const ids2 = await getFavoriteIds();
    expect(ids2).toEqual([]);
  });

  it("getFavoriteArticles returns full article data for favorited items", async () => {
    await upsertArticle({
      title: "Fav Article Full",
      description: "desc",
      url: "https://example.com/fav2",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "test",
      summary: "summary",
      relevance: 9,
      usefulness: 9,
      recency: 9,
      reason: "Great reasoning",
      scoredAt: "2026-01-01T00:00:00Z",
      score: 9,
      embedding: null,
    });

    const all = await dbMod.db.select().from(schemaMod.articles);
    const articleId = all[0].id;

    await toggleFavorite(articleId);

    const articles = await getFavoriteArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Fav Article Full");
    expect(articles[0].url).toBe("https://example.com/fav2");
  });
});
