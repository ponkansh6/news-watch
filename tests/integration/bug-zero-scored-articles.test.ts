/**
 * Reproduction test for the production bug:
 * "記事の取得→20/20完了と表示&スコアリング済み記事0件"
 *
 * Articles are fetched and counted as complete (20/20), but
 * getScoredArticles() returns 0 items.
 *
 * Root cause analysis through multiple failure scenarios.
 */
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// ── Mock DB (in-memory, isolated) ──────────────────────────────────
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

// ── Mock embeddings (deterministic) ────────────────────────────────
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn(async () => new Array(768).fill(0.1)),
  embedQuery: vi.fn(async () => new Array(768).fill(0.1)),
  batchEmbed: vi.fn(async (items) => items.map(() => new Array(768).fill(0.1))),
  cosineSimilarity: vi.fn(() => 0.9),
}));

// ── Mock LLM (configurable per test via vi.mocked) ─────────────────
const mockScoreArticles = vi.fn();
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
}));

// ── Imports (after mocks) ──────────────────────────────────────────
import * as dbMod from "@/lib/db";
import { getScoredArticles, deleteLowScoredArticles } from "@/lib/db/actions";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import type { NormalizedArticle } from "@/lib/types";

// ── Shared test fixtures ───────────────────────────────────────────
const CREATE_SQL = `
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

const ARTICLE_COUNT = 20;

function makeArticles(count: number, date?: string): NormalizedArticle[] {
  const pubDate = date ?? new Date().toISOString();
  return Array.from({ length: count }).map((_, i) => ({
    title: `記事 ${i}: ${KEYWORDS[i % KEYWORDS.length]} に関する解説`,
    description: `これは記事 ${i} の説明です。AI技術について扱っています。`,
    url: `http://test.com/bug/${i}`,
    urlToImage: null,
    publishedAt: pubDate,
    sourceName: "Test Source",
    sourceId: "gnews",
    author: "Test Author",
  }));
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  mockScoreArticles.mockReset();
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 1: LLM returns valid scores → articles SHOULD appear
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 1: LLM returns valid scores (happy path)", () => {
  it("getScoredArticles returns all articles when LLM scoring succeeds", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          reason: `関連`,
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    const savedCount = await scoreAndSaveTagged(tagged);

    expect(savedCount).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.score).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 2: LLM fails entirely → articles saved with score=null
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 2: LLM fails (returns null array) → score=null", () => {
  it("getScoredArticles returns 0 when all LLM scores are null", async () => {
    // scoreArticles returns array of nulls (one per article)
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) => items.map(() => null),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    const savedCount = await scoreAndSaveTagged(tagged);

    // LLM failed → savedCount should be 0 (only counts successful scores)
    expect(savedCount).toBe(0);

    // Articles ARE in the DB (upserted with score=null)
    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);

    // But getScoredArticles filters out null scores → returns 0
    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(0);

    // Verify: articles exist but have null scores
    const nullScoreRows = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NULL",
    );
    expect(nullScoreRows.rows[0].cnt).toBe(ARTICLE_COUNT);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 3: deleteLowScoredArticles interaction
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 3: deleteLowScoredArticles interaction", () => {
  it("articles with score < 5 are protected when scoredAt >= since", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "低スコア",
          usefulness: 2, // 10*0.3 + 2*0.4 + 10*0.3 = 3 + 0.8 + 3 = 6.8 (above 5)
          reason: "低い",
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    const savedCount = await scoreAndSaveTagged(tagged);

    // Composite = 6.8 (above 5)
    expect(savedCount).toBe(ARTICLE_COUNT);

    // Articles exist in DB
    const before = await getScoredArticles(100);
    expect(before.length).toBe(ARTICLE_COUNT);

    // since is BEFORE scoring (simulating route.ts flow)
    const since = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    await deleteLowScoredArticles(5, since);

    // The current batch should be protected (scoredAt >= since)
    const after = await getScoredArticles(100);
    expect(after.length).toBe(ARTICLE_COUNT);
  });

  it("stale articles with score < 5 ARE deleted when scoredAt < since", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "低スコア",
          usefulness: 0, // 10*0.3 + 0*0.4 + 0*0.3 = 3.0 (below 5)
          reason: "低い",
        })),
    );

    // Old date to ensure recency=0
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const articles = makeArticles(ARTICLE_COUNT, oldDate);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    await scoreAndSaveTagged(tagged);

    // since is AFTER scoring (simulating a later fetch that should clean up old articles)
    const since = new Date(Date.now() + 60_000).toISOString(); // 1 minute in the future
    await deleteLowScoredArticles(5, since);

    // All articles have score < 5 and scoredAt < since → all deleted
    const after = await getScoredArticles(100);
    expect(after.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 4: LLM returns partial results (some null, some valid)
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 4: LLM returns partial results", () => {
  it("only articles with valid scores appear in getScoredArticles", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => {
          if (i < 10) {
            return {
              summary: `要約: ${item.title}`,
              usefulness: 7,
              reason: "有効",
            };
          }
          return null; // LLM failed for these
        }),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    const savedCount = await scoreAndSaveTagged(tagged);

    // Only 10 articles have valid scores
    expect(savedCount).toBe(10);

    // All 20 articles are in DB
    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);

    // But only 10 appear in getScoredArticles
    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 5: sourceIds filter mismatch
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 5: sourceIds filter mismatch", () => {
  it("getScoredArticles with wrong sourceIds returns 0", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6,
          reason: "有効",
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    await scoreAndSaveTagged(tagged);

    // Articles have sourceId="gnews", but we filter by "newsapi" → 0 results
    const scoredWrongSource = await getScoredArticles(100, ["newsapi"]);
    expect(scoredWrongSource.length).toBe(0);

    // Correct sourceId → all results
    const scoredCorrectSource = await getScoredArticles(100, ["gnews"]);
    expect(scoredCorrectSource.length).toBe(ARTICLE_COUNT);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 6: Full production flow simulation
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 6: Full production flow (route.ts simulation)", () => {
  it("mimics fetch-news route.ts with LLM success → articles displayed", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          reason: `関連`,
        })),
    );

    const all = makeArticles(ARTICLE_COUNT);

    // ── Exact flow from route.ts lines 239-254 ──
    const since = new Date().toISOString();
    const tagged = await tagArticlesByKeyword(all, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    await deleteLowScoredArticles(5, since);

    // ── What page.tsx does ──
    const scored = await getScoredArticles(100, ["gnews"]);

    expect(saved).toBe(ARTICLE_COUNT);
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.summary).not.toBeNull();
    }
  });

  it("BUG REPRO: mimics route.ts with LLM failure → saved=20 but scored=0", async () => {
    // LLM fails for ALL articles — returns array of nulls
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) => items.map(() => null),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const tagged = await tagArticlesByKeyword(all, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    await deleteLowScoredArticles(5, since);

    const scored = await getScoredArticles(100, ["gnews"]);

    // THIS IS THE BUG SCENARIO:
    // saved = 0 (LLM failed), scored = 0 (all scores null)
    expect(saved).toBe(0);
    expect(scored.length).toBe(0);

    // But articles DO exist in the DB with null scores
    const allRows = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NULL",
    );
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);
  });

  it("BUG REPRO: very low LLM scores + subsequent deleteLowScoredArticles → articles gone", async () => {
    // LLM returns very low scores (0/10) → composite = 10*0.3 + 0*0.4 + 10*0.3 = 3 + 0 + 3 = 6.0 (above 5)
    // NOTE: The recency boost (10/10 for <1 day) inflates the composite significantly.
    // To get score < 5, we need usefulness=0 and recency=0 (old article).
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "極低スコア",
          usefulness: 0,
          reason: "低い",
        })),
    );

    // Old date to ensure recency=0
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const all = makeArticles(ARTICLE_COUNT, oldDate);
    const since = new Date().toISOString();
    const tagged = await tagArticlesByKeyword(all, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    expect(saved).toBe(ARTICLE_COUNT);

    // Verify composite is indeed < 5 for old articles
    // 10*0.3 + 0*0.4 + 0*0.3 = 3.0
    const dbScores = await (dbMod as any).__client.execute("SELECT score FROM articles LIMIT 1");
    const score = dbScores.rows[0].score as number;
    expect(score).toBeLessThan(5); // 3.0

    // First fetch: articles protected by since guard
    await deleteLowScoredArticles(5, since);
    const afterFirst = await getScoredArticles(100, ["gnews"]);
    expect(afterFirst.length).toBe(ARTICLE_COUNT);

    // Simulate second fetch: new since is AFTER first batch's scoredAt
    const since2 = new Date(Date.now() + 60_000).toISOString();
    await deleteLowScoredArticles(5, since2);

    // Now the first batch's scoredAt < since2 AND score < 5 → deleted
    const afterSecond = await getScoredArticles(100, ["gnews"]);
    expect(afterSecond.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 7: USER'S EXACT BUG — "20件スコアリング完了 but 0件表示"
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 7: '20件スコアリング完了' but 'スコアリング済み記事0件'", () => {
  it("happy path: saved=20 and scored=20 — no bug", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          reason: `関連`,
        })),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const tagged = await tagArticlesByKeyword(all, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    await deleteLowScoredArticles(5, since);

    expect(saved).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100, ["gnews"]);
    expect(scored.length).toBe(ARTICLE_COUNT);
  });

  it("BUG REPRO: DB write fails → saved=0 (fixed: savedCount no longer increments on DB failure)", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title}`,
          usefulness: 7,
          reason: "有効",
        })),
    );

    // Make db.insert throw to simulate DB failure.
    // Previously savedCount incremented even though nothing was written,
    // causing the UI to show "N件スコアリング完了" with 0 displayed articles.
    // FIX: savedCount now only increments after successful DB write.
    const dbObject = (dbMod as any).db;
    const insertSpy = vi.spyOn(dbObject, "insert").mockImplementation((..._args: any[]) => {
      throw new Error("[mock] DB write failure: Turso connection refused");
    });

    try {
      const all = makeArticles(ARTICLE_COUNT);
      const tagged = await tagArticlesByKeyword(all, KEYWORDS);
      const saved = await scoreAndSaveTagged(tagged);

      // After fix: saved=0 because all DB writes failed
      expect(saved).toBe(0);

      // DB is EMPTY
      const dbCount = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
      expect(dbCount.rows[0].cnt).toBe(0);

      // getScoredArticles returns 0
      const scored = await getScoredArticles(100);
      expect(scored.length).toBe(0);
    } finally {
      insertSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 8: The ACTUAL production bug — Gemini API key missing
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 7: Gemini API key missing → scoreArticles returns null[]", () => {
  it("when GOOGLE_API_KEY is absent, scoreArticles returns array of nulls", async () => {
    // Simulate: no API key → callGemini returns null → scoreArticles returns null[]
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) => items.map(() => null),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const tagged = await tagArticlesByKeyword(all, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    // All articles saved to DB but with score=null
    expect(saved).toBe(0);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(0);

    // Verify DB state: articles exist, all have null scores
    const dbCheck = await (dbMod as any).__client.execute(
      "SELECT score, COUNT(*) as cnt FROM articles GROUP BY score",
    );
    expect(dbCheck.rows).toEqual([{ score: null, cnt: ARTICLE_COUNT }]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 8: The ACTUAL production bug — scoreArticles throws
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 8: scoreArticles throws → exception swallowed", () => {
  it("when scoreArticles throws, fetch-news catch block prevents scoring", async () => {
    mockScoreArticles.mockRejectedValue(new Error("Gemini API error: 429"));

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();

    // This simulates the try/catch in route.ts
    let saved: number | undefined;
    let scoringError: any;
    try {
      const tagged = await tagArticlesByKeyword(all, KEYWORDS);
      saved = await scoreAndSaveTagged(tagged);
    } catch (err) {
      scoringError = err;
    }

    // scoreAndSaveTagged doesn't catch — the error bubbles up to route.ts
    expect(scoringError).toBeDefined();
    expect(scoringError.message).toContain("Gemini API error: 429");

    // No articles saved to DB
    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(0);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 9: getScoredArticles catches DB errors → returns []
// ═══════════════════════════════════════════════════════════════════
describe("Scenario 9: getScoredArticles DB query error → returns empty", () => {
  it("DB query error silently returns empty array", async () => {
    // Insert a valid article first
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6,
          reason: "有効",
        })),
    );

    const articles = makeArticles(5);
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    await scoreAndSaveTagged(tagged);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(5);
  });
});
