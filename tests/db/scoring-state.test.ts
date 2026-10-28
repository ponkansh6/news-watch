import { describe, expect, test, beforeAll, beforeEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import { articles } from "@/lib/db/schema";
import * as dbMod from "@/lib/db";
import { getScoringStateByUrls, deleteStaleLowScored, upsertArticles } from "@/lib/db";
import { selectForScoring } from "@/app/api/fetch-news/pipeline/select";
import { computeContentHash } from "@/lib/scoring-signature";

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

  test("batch upsert stores per-article scoring state and selection detects hash/signature changes", async () => {
    const publishedAt = new Date().toISOString();
    const articleA = {
      title: "Article A",
      description: "Description A",
      url: "https://example.com/batch-a",
      urlToImage: null,
      publishedAt,
      sourceName: "Example",
      sourceId: "example",
      author: null,
    };
    const articleB = {
      title: "Article B",
      description: "Description B",
      url: "https://example.com/batch-b",
      urlToImage: null,
      publishedAt,
      sourceName: "Example",
      sourceId: "example",
      author: null,
    };
    const oldScore = {
      keyword: "test",
      summary: "summary",
      relevance: 7,
      usefulness: 7,
      recency: 7,
      reason: "reason",
      scoredAt: publishedAt,
      score: 7,
    };

    await dbMod.db.insert(articles).values([
      {
        ...articleA,
        ...oldScore,
        contentHash: "old-hash-a",
        scoringSignature: "signature-a",
      },
      {
        ...articleB,
        ...oldScore,
        contentHash: computeContentHash(articleB.title, articleB.description),
        scoringSignature: "old-signature-b",
      },
    ]);

    const result = await upsertArticles([
      {
        ...articleA,
        ...oldScore,
        contentHash: computeContentHash(articleA.title, articleA.description),
        scoringSignature: "signature-a",
      },
      {
        ...articleB,
        ...oldScore,
        contentHash: computeContentHash(articleB.title, articleB.description),
        scoringSignature: "signature-b",
      },
    ]);

    expect(result).toEqual({ succeeded: [articleA.url, articleB.url], failed: [] });
    const saved = await getScoringStateByUrls([articleA.url, articleB.url]);
    expect(saved.get(articleA.url)).toMatchObject({
      contentHash: computeContentHash(articleA.title, articleA.description),
      scoringSignature: "signature-a",
    });
    expect(saved.get(articleB.url)).toMatchObject({
      contentHash: computeContentHash(articleB.title, articleB.description),
      scoringSignature: "signature-b",
    });

    const unchangedA = await selectForScoring([articleA], "signature-a");
    expect(unchangedA.toScore).toEqual([]);
    expect(unchangedA.skipped).toEqual([articleA]);

    const changedContentA = await selectForScoring(
      [{ ...articleA, title: "Changed title" }],
      "signature-a",
    );
    expect(changedContentA.toScore).toHaveLength(1);

    const unchangedB = await selectForScoring([articleB], "signature-b");
    expect(unchangedB.toScore).toEqual([]);
    const changedSignatureB = await selectForScoring([articleB], "old-signature-b");
    expect(changedSignatureB.toScore).toHaveLength(1);
  });

  test("batch upsert preserves the legacy null scoring-state skip behavior", async () => {
    const legacyArticle = {
      title: "Legacy article",
      description: null,
      url: "https://example.com/legacy-scored",
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Example",
      sourceId: "example",
      author: null,
    };
    await dbMod.db.insert(articles).values({
      ...legacyArticle,
      keyword: "test",
      scoredAt: new Date().toISOString(),
      score: 7,
      contentHash: null,
      scoringSignature: null,
    });

    const legacyUpdate = await upsertArticles([
      {
        ...legacyArticle,
        keyword: "test",
        summary: null,
        relevance: null,
        usefulness: null,
        recency: null,
        reason: null,
        scoredAt: new Date().toISOString(),
        score: 7,
        contentHash: null,
        scoringSignature: null,
      },
    ]);
    expect(legacyUpdate).toEqual({ succeeded: [legacyArticle.url], failed: [] });

    const selected = await selectForScoring([legacyArticle], "current-signature");
    expect(selected.toScore).toEqual([]);
    expect(selected.skipped).toEqual([legacyArticle]);
  });

  test("batch failure falls back to individual upserts and reports partial success", async () => {
    const publishedAt = new Date().toISOString();
    const validUrl = "https://example.com/fallback-valid";
    const invalidUrl = "https://example.com/fallback-invalid";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await upsertArticles([
        {
          title: "Valid article",
          description: null,
          url: validUrl,
          urlToImage: null,
          publishedAt,
          sourceName: "Example",
          sourceId: "example",
          author: null,
          keyword: "test",
          summary: null,
          relevance: null,
          usefulness: null,
          recency: null,
          reason: null,
          scoredAt: publishedAt,
          score: 7,
          contentHash: "valid-hash",
          scoringSignature: "valid-signature",
        },
        {
          title: null as unknown as string,
          description: null,
          url: invalidUrl,
          urlToImage: null,
          publishedAt,
          sourceName: "Example",
          sourceId: "example",
          author: null,
          keyword: "test",
          summary: null,
          relevance: null,
          usefulness: null,
          recency: null,
          reason: null,
          scoredAt: publishedAt,
          score: 7,
          contentHash: "invalid-hash",
          scoringSignature: "invalid-signature",
        },
      ]);

      expect(result).toEqual({ succeeded: [validUrl], failed: [invalidUrl] });
      const rows = await dbMod.db.select().from(articles);
      expect(rows.map((row) => row.url)).toEqual([validUrl]);
      expect(rows[0]).toMatchObject({
        contentHash: "valid-hash",
        scoringSignature: "valid-signature",
      });
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
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
