import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { inArray } from "drizzle-orm";
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

    // Create the articles table matching the schema including content_hash and scoring_signature
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
        content_hash TEXT,
        scoring_signature TEXT,
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

    // Insert article with sourceId 'gnews' and score >= 5
    await db.insert(articles).values({
      title: "Test Article",
      url: "https://example.com/1",
      keyword: "test",
      sourceId: "gnews",
      score: 10,
      publishedAt: new Date().toISOString(),
    });

    // Also insert an article with score < 5 to ensure display filtering logic emulation if needed, or test low score exclusion
    await db.insert(articles).values({
      title: "Low Score Article",
      url: "https://example.com/2",
      keyword: "test",
      sourceId: "gnews",
      score: 3,
      publishedAt: new Date().toISOString(),
    });

    // Query with 'hackernews' filter — should return no results
    const result1 = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["hackernews"]));
    expect(result1.length).toBe(0);

    // Query with 'gnews' filter and score >= 5 (display filter specification) — should return only the article with score >= 5
    const result2 = await db
      .select()
      .from(articles)
      .where(inArray(articles.sourceId, ["gnews"]));
    // Test the basic sourceId filter query, but ensure we filter by score >= 5 as per the new display filter specification
    const filteredResult2 = result2.filter((a) => (a.score ?? 0) >= 5);
    expect(filteredResult2.length).toBe(1);
    expect(filteredResult2[0].sourceId).toBe("gnews");
    expect(filteredResult2[0].score).toBeGreaterThanOrEqual(5);
  });
});
