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
  toggleNotForMe,
  getNotForMeArticles,
  getNotForMeStats,
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

const CREATE_NOT_FOR_ME_SQL = `
  CREATE TABLE IF NOT EXISTS not_for_me (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_SQL);
  await (dbMod as any).__client.execute(CREATE_NOT_FOR_ME_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM not_for_me");
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

describe("Not For Me database actions", () => {
  it("toggleNotForMe adds when not exists and removes when exists", async () => {
    await upsertArticle({
      title: "NFM Test",
      description: null,
      url: "https://example.com/nfm1",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "test",
      summary: "summary",
      relevance: 5,
      usefulness: 5,
      recency: 5,
      reason: "Not for me",
      scoredAt: "2026-01-01T00:00:00Z",
      score: 5,
      embedding: null,
    });

    const all = await dbMod.db.select().from(schemaMod.articles);
    const articleId = all[0].id;

    // Toggle on
    const res1 = await toggleNotForMe(articleId);
    expect(res1).toBe(true);

    const articles = await getNotForMeArticles();
    expect(articles.length).toBe(1);
    expect(articles[0].id).toBe(articleId);

    // Toggle off
    const res2 = await toggleNotForMe(articleId);
    expect(res2).toBe(false);

    const articlesAfter = await getNotForMeArticles();
    expect(articlesAfter).toEqual([]);
  });

  it("getNotForMeStats returns correct count and maxId", async () => {
    const statsEmpty = await getNotForMeStats();
    expect(statsEmpty).toEqual({ count: 0, maxId: 0 });

    await upsertArticle({
      title: "NFM Test 2",
      description: null,
      url: "https://example.com/nfm2",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
      keyword: "test",
      summary: "summary",
      relevance: 5,
      usefulness: 5,
      recency: 5,
      reason: "Not for me",
      scoredAt: "2026-01-01T00:00:00Z",
      score: 5,
      embedding: null,
    });

    const all = await dbMod.db.select().from(schemaMod.articles);
    await toggleNotForMe(all[0].id);

    const stats = await getNotForMeStats();
    expect(stats.count).toBe(1);
    expect(stats.maxId).toBeGreaterThan(0);
  });
});
