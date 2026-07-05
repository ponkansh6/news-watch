import { beforeAll, describe, expect, test } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import { articles } from "../../src/lib/db/schema";

// Test Case 1: ローカルSQLiteファイルを使用した正常系テスト
// actions.ts の upsertArticle / getScoredArticles は Turso 接続前提のため、
// ここでは同一クライアントで drizzle + 生SQLを組み合わせてCRUDをテストする

describe("Test Case 1: 新カラムを含むarticlesテーブルのCRUD正常系", () => {
  let client: Client;

  beforeAll(async () => {
    // libsqlのin-memoryクライアントを作成（ drizzle と共通で使う ）
    client = createClient({ url: ":memory:" });

    // テーブルを生SQLで作成（新しいカラムを含む）
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
        reason TEXT,
        scored_at TEXT,
        score REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )
    `);

    // インデックスを作成
    await client.execute(`CREATE INDEX idx_keyword ON articles(keyword)`);
    await client.execute(`CREATE INDEX idx_relevance_pub ON articles(relevance, published_at)`);
    await client.execute(`CREATE INDEX idx_recency_pub ON articles(recency, published_at)`);
    await client.execute(`CREATE INDEX idx_created_at ON articles(created_at)`);
  });

  test("should insert and query article with all new score columns", async () => {
    // drizzle で同じ client を使って insert
    const db = drizzle({ client, schema: { articles } });
    await db.insert(articles).values({
      title: "Test Article",
      description: "Test Description",
      url: "https://example.com/test",
      urlToImage: "https://example.com/img.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      author: "Test Author",
      keyword: "test",
      summary: "LLM summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      reason: "Test reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.0,
    });

    // クエリ: score IS NOT NULL ORDER BY score DESC
    const rows = await db
      .select()
      .from(articles)
      .where(isNotNull(articles.score))
      .orderBy(desc(articles.score));

    // 検証
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((r) => r.url === "https://example.com/test")!;
    expect(row).toBeDefined();
    expect(row.relevance).toBe(8.0);
    expect(row.usefulness).toBe(7.0);
    expect(row.recency).toBe(6.0);
    expect(row.score).toBe(7.0);
  });

  test("should handle ON CONFLICT upsert with new columns", async () => {
    const db = drizzle({ client, schema: { articles } });

    // 初回insert
    await db.insert(articles).values({
      title: "Upsert Test",
      description: "Original",
      url: "https://example.com/upsert",
      publishedAt: "2024-06-01T00:00:00Z",
      keyword: "test",
      relevance: 5.0,
      usefulness: 5.0,
      recency: 5.0,
      score: 5.0,
    });

    // 同じURLでupsert（スコア更新）
    await db
      .insert(articles)
      .values({
        title: "Upsert Test Updated",
        description: "Updated",
        url: "https://example.com/upsert",
        publishedAt: "2024-06-02T00:00:00Z",
        keyword: "test",
        relevance: 9.0,
        usefulness: 8.0,
        recency: 10.0,
        score: 9.0,
      })
      .onConflictDoUpdate({
        target: articles.url,
        set: {
          title: "Upsert Test Updated",
          relevance: 9.0,
          usefulness: 8.0,
          recency: 10.0,
          score: 9.0,
        },
      });

    // 1件だけ、最新スコアで取得されること
    const rows = await db
      .select()
      .from(articles)
      .where(and(isNotNull(articles.score), eq(articles.url, "https://example.com/upsert")));

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Upsert Test Updated");
    expect(rows[0].relevance).toBe(9.0);
    expect(rows[0].usefulness).toBe(8.0);
    expect(rows[0].recency).toBe(10.0);
  });
});

// Test Case 2: Turso DBのカラム存在確認（問題の再現）
// 環境変数から Turso のクレデンシャルを読み込み、PRAGMA table_info で実際のカラム一覧を取得
// relevance, usefulness, recency が存在するか確認 → 無ければ「Migration needed!」エラー

describe("Test Case 2: Turso DBのカラム存在確認（問題の再現）", () => {
  test("should verify relevance, usefulness, recency columns exist in Turso DB", async () => {
    const databaseUrl = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!databaseUrl || !authToken) {
      console.warn("SKIP: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
      return;
    }

    const client = createClient({ url: databaseUrl, authToken });
    const result = await client.execute("PRAGMA table_info(articles)");
    const columns = result.rows as any[];
    const columnNames = columns.map((col: any) => col.name);

    const missing: string[] = [];
    if (!columnNames.includes("relevance")) missing.push("relevance");
    if (!columnNames.includes("usefulness")) missing.push("usefulness");
    if (!columnNames.includes("recency")) missing.push("recency");

    if (missing.length > 0) {
      throw new Error(`Migration needed! Missing columns in Turso DB: ${missing.join(", ")}`);
    }

    expect(columnNames).toContain("relevance");
    expect(columnNames).toContain("usefulness");
    expect(columnNames).toContain("recency");
  });
});
