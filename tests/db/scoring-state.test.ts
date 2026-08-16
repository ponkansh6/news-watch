import { describe, expect, test, beforeAll, beforeEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import { articles } from "@/lib/db/schema";
import * as dbMod from "@/lib/db";
import { getScoringStateByUrls, deleteStaleLowScored } from "@/lib/db";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

describe("Scoring State and Tombstone Retention (Tier 4)", () => {
  let client: Client;

  beforeAll(async () => {
    client = (dbMod as any).__client;
    // articles テーブルは tests/setup-env.ts のマイグレーション適用で既に存在する
    // （再作成を防ぐため IF NOT EXISTS を付ける）
    await client.execute(`
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
        content_hash TEXT,
        scoring_signature TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )
    `);
  });

  beforeEach(async () => {
    await client.execute("DELETE FROM articles");
  });

  test("getScoringStateByUrls chunks 250 URLs in batches of 200 and returns scoring state map", async () => {
    const urls = Array.from({ length: 250 }, (_, i) => `https://example.com/article-${i}`);

    for (let i = 0; i < 50; i++) {
      await dbMod.db.insert(articles).values({
        title: `Title ${i}`,
        url: urls[i],
        publishedAt: new Date().toISOString(),
        keyword: "test",
        score: 8.0,
        contentHash: `ch-${i}`,
        scoringSignature: `sig-${i}`,
        scoredAt: new Date().toISOString(),
      });
    }

    const stateMap = await getScoringStateByUrls(urls);
    expect(stateMap.size).toBe(50);
    expect(stateMap.get(urls[0])).toMatchObject({
      score: 8.0,
      contentHash: "ch-0",
      scoringSignature: "sig-0",
    });
    expect(stateMap.has(urls[200])).toBe(false);
  });

  test("getScoringStateByUrls returns empty map for empty array", async () => {
    const stateMap = await getScoringStateByUrls([]);
    expect(stateMap.size).toBe(0);
  });

  test("deleteStaleLowScored prunes low scores older than 30 days and keeps recent or high scores", async () => {
    const now = Date.now();
    const thirtyOneDaysAgo = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

    await dbMod.db.insert(articles).values({
      title: "Stale Low Score",
      url: "https://example.com/stale-low",
      publishedAt: thirtyOneDaysAgo,
      keyword: "test",
      score: 3.0,
    });

    await dbMod.db.insert(articles).values({
      title: "Recent Low Score",
      url: "https://example.com/recent-low",
      publishedAt: tenDaysAgo,
      keyword: "test",
      score: 3.0,
    });

    await dbMod.db.insert(articles).values({
      title: "Stale High Score",
      url: "https://example.com/stale-high",
      publishedAt: thirtyOneDaysAgo,
      keyword: "test",
      score: 8.0,
    });

    await deleteStaleLowScored(5, 30);

    const remaining = await dbMod.db.select().from(articles);
    const remainingUrls = remaining.map((r) => r.url);

    expect(remainingUrls).not.toContain("https://example.com/stale-low");
    expect(remainingUrls).toContain("https://example.com/recent-low");
    expect(remainingUrls).toContain("https://example.com/stale-high");
  });
});
