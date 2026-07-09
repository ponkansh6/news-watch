import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { inArray, isNotNull } from "drizzle-orm";
import { articles } from "../src/lib/db/schema";

// Test 1: Polling Logic Premature Completion
describe("Polling Logic", () => {
  it("should evaluate true when totalScored >= totalFetched even if new articles are not scored", () => {
    // Mock data structure
    const fetchedResults = [{ keyword: "test", fetched: 5, scored: 0, errors: [] }];
    const statusData = { status: [{ keyword: "test", scored: 10 }] }; // 10 old articles

    const updatedResults = fetchedResults.map((r) => {
      const status = statusData.status.find((s: any) => s.keyword === r.keyword);
      return { ...r, scored: status?.scored ?? 0 };
    });

    const totalFetched = fetchedResults.reduce((acc, r) => acc + r.fetched, 0);
    const totalScored = updatedResults.reduce((acc, r) => acc + r.scored, 0);

    // 10 >= 5 is true
    expect(totalScored).toBe(10);
    expect(totalFetched).toBe(5);
    expect(totalScored >= totalFetched).toBe(true);
  });
});

// Test 2: Source Filtering (self-contained in-memory DB)
describe("Source Filtering", () => {
  let client: Client;

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });

    // Create the articles table matching the schema
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
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )
    `);

    await client.execute("CREATE INDEX idx_keyword ON articles(keyword)");
    await client.execute("CREATE INDEX idx_relevance_pub ON articles(relevance, published_at)");
    await client.execute("CREATE INDEX idx_recency_pub ON articles(recency, published_at)");
    await client.execute("CREATE INDEX idx_created_at ON articles(created_at)");
  });

  beforeEach(async () => {
    await client.execute("DELETE FROM articles");
  });

  it("should filter articles by sourceId", async () => {
    const db = drizzle({ client, schema: { articles } });

    // Insert article with sourceId 'gnews'
    await db.insert(articles).values({
      title: "Test Article",
      url: "https://example.com/1",
      keyword: "test",
      sourceId: "gnews",
      score: 10,
      publishedAt: new Date().toISOString(),
    });

    // Query with 'hackernews' filter — should return no results
    const result1 = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["hackernews"]));
    expect(result1.length).toBe(0);

    // Query with 'gnews' filter — should return the inserted article
    const result2 = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["gnews"]));
    expect(result2.length).toBe(1);
    expect(result2[0].sourceId).toBe("gnews");
  });
});
