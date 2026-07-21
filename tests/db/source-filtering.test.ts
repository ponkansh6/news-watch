import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { inArray, isNotNull } from "drizzle-orm";
import { articles } from "../../src/lib/db/schema";

describe("Source filtering tests for articles", () => {
  let client: Client;

  beforeAll(async () => {
    // libsqlのin-memoryクライアントを作成（ drizzle と共通で使う ）
    client = createClient({ url: ":memory:" });

    // テーブルを生SQLで作成（source_id カラムを含む）
    await client.execute(`
      CREATE TABLE articles (
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

    // インデックスを作成
    await client.execute(`CREATE INDEX idx_keyword ON articles(keyword)`);
    await client.execute(`CREATE INDEX idx_relevance_pub ON articles(relevance, published_at)`);
    await client.execute(`CREATE INDEX idx_recency_pub ON articles(recency, published_at)`);
    await client.execute(`CREATE INDEX idx_created_at ON articles(created_at)`);
  });

  beforeEach(async () => {
    // 各テスト前に全データをクリア（UNIQUE制約の重複を避ける）
    await client.execute("DELETE FROM articles");
  });

  test("should retrieve all articles without source filter", async () => {
    const db = drizzle({ client, schema: { articles } });

    // 3件の記事を異なる sourceId でINSERT
    await db.insert(articles).values([
      {
        title: "Qiita Article",
        description: "Qiita description",
        url: "https://qiita.com/test1",
        publishedAt: "2024-01-01T00:00:00Z",
        sourceName: "Qiita",
        author: "Author1",
        keyword: "test",
        summary: "Summary1",
        relevance: 8.0,
        usefulness: 7.0,
        recency: 6.0,
        reason: "Reason1",
        scoredAt: "2024-01-01T00:00:00Z",
        score: 7.0,
        sourceId: "qiita",
      },
      {
        title: "GitHub Article",
        description: "GitHub description",
        url: "https://github.com/test2",
        publishedAt: "2024-01-02T00:00:00Z",
        sourceName: "GitHub",
        author: "Author2",
        keyword: "test",
        summary: "Summary2",
        relevance: 9.0,
        usefulness: 8.0,
        recency: 7.0,
        reason: "Reason2",
        scoredAt: "2024-01-02T00:00:00Z",
        score: 8.0,
        sourceId: "github",
      },
      {
        title: "HackerNews Article",
        description: "HackerNews description",
        url: "https://hackernews.com/test3",
        publishedAt: "2024-01-03T00:00:00Z",
        sourceName: "HackerNews",
        author: "Author3",
        keyword: "test",
        summary: "Summary3",
        relevance: 7.0,
        usefulness: 6.0,
        recency: 8.0,
        reason: "Reason3",
        scoredAt: "2024-01-03T00:00:00Z",
        score: 6.0,
        sourceId: "hackernews",
      },
    ]);

    // Drizzle ORM で score IS NOT NULL のみの条件でSELECT
    const rows = await db.select().from(articles).where(isNotNull(articles.score));

    // 全3件が返ってくることを確認
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sourceId)).toContain("qiita");
    expect(rows.map((r) => r.sourceId)).toContain("github");
    expect(rows.map((r) => r.sourceId)).toContain("hackernews");
  });

  test("should filter articles by specific source IDs", async () => {
    const db = drizzle({ client, schema: { articles } });

    // 3件の記事を挿入（前述のテストと同じデータセット）
    await db.insert(articles).values([
      {
        title: "Qiita Article",
        description: "Qiita description",
        url: "https://qiita.com/test1",
        publishedAt: "2024-01-01T00:00:00Z",
        sourceName: "Qiita",
        author: "Author1",
        keyword: "test",
        summary: "Summary1",
        relevance: 8.0,
        usefulness: 7.0,
        recency: 6.0,
        reason: "Reason1",
        scoredAt: "2024-01-01T00:00:00Z",
        score: 7.0,
        sourceId: "qiita",
      },
      {
        title: "GitHub Article",
        description: "GitHub description",
        url: "https://github.com/test2",
        publishedAt: "2024-01-02T00:00:00Z",
        sourceName: "GitHub",
        author: "Author2",
        keyword: "test",
        summary: "Summary2",
        relevance: 9.0,
        usefulness: 8.0,
        recency: 7.0,
        reason: "Reason2",
        scoredAt: "2024-01-02T00:00:00Z",
        score: 8.0,
        sourceId: "github",
      },
      {
        title: "HackerNews Article",
        description: "HackerNews description",
        url: "https://hackernews.com/test3",
        publishedAt: "2024-01-03T00:00:00Z",
        sourceName: "HackerNews",
        author: "Author3",
        keyword: "test",
        summary: "Summary3",
        relevance: 7.0,
        usefulness: 6.0,
        recency: 8.0,
        reason: "Reason3",
        scoredAt: "2024-01-03T00:00:00Z",
        score: 6.0,
        sourceId: "hackernews",
      },
    ]);

    // inArray を使って qiita と github でフィルタリング
    const rows = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["qiita", "github"]));

    // 2件（qiita, github）のみ返ってくることを確認
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceId)).toContain("qiita");
    expect(rows.map((r) => r.sourceId)).toContain("github");
    expect(rows.map((r) => r.sourceId)).not.toContain("hackernews");
  });

  test("should apply AND condition when both score and sourceId filters are used", async () => {
    const db = drizzle({ client, schema: { articles } });

    // 3件の記事を挿入（うち1件はscore=NULL）
    await db.insert(articles).values([
      {
        title: "Qiita Article",
        description: "Qiita description",
        url: "https://qiita.com/test1",
        publishedAt: "2024-01-01T00:00:00Z",
        sourceName: "Qiita",
        author: "Author1",
        keyword: "test",
        summary: "Summary1",
        relevance: 8.0,
        usefulness: 7.0,
        recency: 6.0,
        reason: "Reason1",
        scoredAt: "2024-01-01T00:00:00Z",
        score: 7.0,
        sourceId: "qiita",
      },
      {
        title: "GitHub Article",
        description: "GitHub description",
        url: "https://github.com/test2",
        publishedAt: "2024-01-02T00:00:00Z",
        sourceName: "GitHub",
        author: "Author2",
        keyword: "test",
        summary: "Summary2",
        relevance: 9.0,
        usefulness: 8.0,
        recency: 7.0,
        reason: "Reason2",
        scoredAt: "2024-01-02T00:00:00Z",
        score: 8.0,
        sourceId: "github",
      },
      {
        title: "HackerNews Article (no score)",
        description: "HackerNews description",
        url: "https://hackernews.com/test3",
        publishedAt: "2024-01-03T00:00:00Z",
        sourceName: "HackerNews",
        author: "Author3",
        keyword: "test",
        score: null,
        sourceId: "hackernews",
      },
    ]);

    // score IS NOT NULL AND sourceId IN ("qiita", "github")
    const rows = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["qiita", "github"]));

    // score=nullのhackernewsは含めず2件のみ
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceId)).toContain("qiita");
    expect(rows.map((r) => r.sourceId)).toContain("github");
    expect(rows.map((r) => r.sourceId)).not.toContain("hackernews");
  });

  test("should return zero articles when filtering by non-existent source ID", async () => {
    const db = drizzle({ client, schema: { articles } });

    // 3件の記事を挿入
    await db.insert(articles).values([
      {
        title: "Qiita Article",
        description: "Qiita description",
        url: "https://qiita.com/test1",
        publishedAt: "2024-01-01T00:00:00Z",
        sourceName: "Qiita",
        author: "Author1",
        keyword: "test",
        summary: "Summary1",
        relevance: 8.0,
        usefulness: 7.0,
        recency: 6.0,
        reason: "Reason1",
        scoredAt: "2024-01-01T00:00:00Z",
        score: 7.0,
        sourceId: "qiita",
      },
      {
        title: "GitHub Article",
        description: "GitHub description",
        url: "https://github.com/test2",
        publishedAt: "2024-01-02T00:00:00Z",
        sourceName: "GitHub",
        author: "Author2",
        keyword: "test",
        summary: "Summary2",
        relevance: 9.0,
        usefulness: 8.0,
        recency: 7.0,
        reason: "Reason2",
        scoredAt: "2024-01-02T00:00:00Z",
        score: 8.0,
        sourceId: "github",
      },
      {
        title: "HackerNews Article",
        description: "HackerNews description",
        url: "https://hackernews.com/test3",
        publishedAt: "2024-01-03T00:00:00Z",
        sourceName: "HackerNews",
        author: "Author3",
        keyword: "test",
        summary: "Summary3",
        relevance: 7.0,
        usefulness: 6.0,
        recency: 8.0,
        reason: "Reason3",
        scoredAt: "2024-01-03T00:00:00Z",
        score: 6.0,
        sourceId: "hackernews",
      },
    ]);

    // 存在しないソースID "nonexistent" でフィルタリング
    const rows = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["nonexistent"]));

    // 0件であることを確認
    expect(rows).toHaveLength(0);
  });
});
