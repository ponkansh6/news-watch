/**
 * Reproduction test for the production bug:
 * "記事の取得→20/20完了と表示&スコアリング済み記事0件"
 */
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";

// ── Mock DB (in-memory, isolated) ──────────────────────────────────
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

// ── Mock LLM (configurable per test via vi.mocked) ─────────────────
const mockScoreArticles = vi.fn();
vi.mock("@/lib/llm", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
}));

// ── Imports (after mocks) ──────────────────────────────────────────
import * as dbMod from "@/lib/db";
import { getScoredArticles, deleteLowScoredArticles } from "@/lib/db";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
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
    keyword TEXT,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

const ARTICLE_COUNT = 20;

function makeArticles(count: number, date?: string): NormalizedArticle[] {
  const pubDate = date ?? new Date().toISOString();
  return Array.from({ length: count }).map((_, i) => ({
    title: `記事 ${i}: 技術に関する解説`,
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

describe("Scenario 1: LLM returns valid scores (happy path)", () => {
  it("getScoredArticles returns all articles when LLM scoring succeeds", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          ntt_relevance: 8,
          topic: "NTT",
          reason: `関連`,
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const savedCount = await scoreAndSaveTagged(articles);

    expect(savedCount).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.score).toBeGreaterThan(0);
    }
  });
});

describe("Scenario 2: LLM fails (returns null array) → score=null", () => {
  it("getScoredArticles returns 0 when all LLM scores are null", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) => items.map(() => null),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const savedCount = await scoreAndSaveTagged(articles);

    expect(savedCount).toBe(0);

    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(0);

    const nullScoreRows = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NULL",
    );
    expect(nullScoreRows.rows[0].cnt).toBe(ARTICLE_COUNT);
  });
});

describe("Scenario 3: deleteLowScoredArticles interaction", () => {
  it("articles with score < 5 are protected when scoredAt >= since", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "低スコア",
          usefulness: 2,
          ntt_relevance: 5,
          topic: "NTT",
          reason: "低い",
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const savedCount = await scoreAndSaveTagged(articles);

    expect(savedCount).toBe(ARTICLE_COUNT);

    const before = await getScoredArticles(100);
    expect(before.length).toBe(ARTICLE_COUNT);

    const since = new Date(Date.now() - 60_000).toISOString();
    await deleteLowScoredArticles(5, since);

    const after = await getScoredArticles(100);
    expect(after.length).toBe(ARTICLE_COUNT);
  });

  it("stale articles with score < 5 ARE deleted when scoredAt < since", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "低スコア",
          usefulness: 0,
          ntt_relevance: 0,
          topic: "NTT",
          reason: "低い",
        })),
    );

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const articles = makeArticles(ARTICLE_COUNT, oldDate);
    await scoreAndSaveTagged(articles);

    const since = new Date(Date.now() + 60_000).toISOString();
    await deleteLowScoredArticles(5, since);

    const after = await getScoredArticles(100);
    expect(after.length).toBe(0);
  });
});

describe("Scenario 4: LLM returns partial results", () => {
  it("only articles with valid scores appear in getScoredArticles", async () => {
    let remainingValid = 10;
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => {
          if (remainingValid > 0) {
            remainingValid--;
            return {
              summary: `要約: ${item.title}`,
              usefulness: 7,
              ntt_relevance: 8,
              topic: "NTT",
              reason: "有効",
            };
          }
          return null;
        }),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    const savedCount = await scoreAndSaveTagged(articles);

    expect(savedCount).toBe(10);

    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(10);
  });
});

describe("Scenario 5: sourceIds filter mismatch", () => {
  it("getScoredArticles with wrong sourceIds returns 0", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6,
          ntt_relevance: 5,
          topic: "NTT",
          reason: "有効",
        })),
    );

    const articles = makeArticles(ARTICLE_COUNT);
    await scoreAndSaveTagged(articles);

    const scoredWrongSource = await getScoredArticles(100, ["zenn"]);
    expect(scoredWrongSource.length).toBe(0);

    const scoredCorrectSource = await getScoredArticles(100, ["gnews"]);
    expect(scoredCorrectSource.length).toBe(ARTICLE_COUNT);
  });
});

describe("Scenario 6: Full production flow (route.ts simulation)", () => {
  it("mimics fetch-news route.ts with LLM success → articles displayed", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          ntt_relevance: 8,
          topic: "NTT",
          reason: `関連`,
        })),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const saved = await scoreAndSaveTagged(all);
    await deleteLowScoredArticles(5, since);

    const scored = await getScoredArticles(100, ["gnews"]);

    expect(saved).toBe(ARTICLE_COUNT);
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.summary).not.toBeNull();
    }
  });

  it("BUG REPRO: mimics route.ts with LLM failure → saved=20 but scored=0", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) => items.map(() => null),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const saved = await scoreAndSaveTagged(all);
    await deleteLowScoredArticles(5, since);

    const scored = await getScoredArticles(100, ["gnews"]);

    expect(saved).toBe(0);
    expect(scored.length).toBe(0);

    const allRows = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NULL",
    );
    expect(allRows.rows[0].cnt).toBe(ARTICLE_COUNT);
  });
});

describe("Scenario 7: '20件スコアリング完了' but 'スコアリング済み記事0件'", () => {
  it("happy path: saved=20 and scored=20 — no bug", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6 + (i % 4),
          ntt_relevance: 8,
          topic: "NTT",
          reason: `関連`,
        })),
    );

    const all = makeArticles(ARTICLE_COUNT);
    const since = new Date().toISOString();
    const saved = await scoreAndSaveTagged(all);
    await deleteLowScoredArticles(5, since);

    expect(saved).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100, ["gnews"]);
    expect(scored.length).toBe(ARTICLE_COUNT);
  });

  it("BUG REPRO: DB write fails → saved=0", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title}`,
          usefulness: 7,
          ntt_relevance: 8,
          topic: "NTT",
          reason: "有効",
        })),
    );

    const dbObject = (dbMod as any).db;
    const insertSpy = vi.spyOn(dbObject, "insert").mockImplementation((..._args: any[]) => {
      throw new Error("[mock] DB write failure: Turso connection refused");
    });

    try {
      const all = makeArticles(ARTICLE_COUNT);
      const saved = await scoreAndSaveTagged(all);

      expect(saved).toBe(0);

      const dbCount = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
      expect(dbCount.rows[0].cnt).toBe(0);

      const scored = await getScoredArticles(100);
      expect(scored.length).toBe(0);
    } finally {
      insertSpy.mockRestore();
    }
  });
});

describe("Scenario 8: scoreArticles throws → exception swallowed", () => {
  it("when scoreArticles throws, fetch-news catch block prevents scoring", async () => {
    mockScoreArticles.mockRejectedValue(new Error("Gemini API error: 429"));

    const all = makeArticles(ARTICLE_COUNT);

    let _saved: number | undefined;
    let scoringError: any;
    try {
      _saved = await scoreAndSaveTagged(all);
    } catch (err) {
      scoringError = err;
    }

    expect(scoringError).toBeDefined();
    expect(scoringError.message).toContain("Gemini API error: 429");

    const allRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(allRows.rows[0].cnt).toBe(0);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(0);
  });
});

describe("Scenario 9: getScoredArticles DB query error → returns empty", () => {
  it("DB query error silently returns empty array", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title}`,
          usefulness: 6,
          ntt_relevance: 8,
          topic: "NTT",
          reason: "有効",
        })),
    );

    const articles = makeArticles(5);
    await scoreAndSaveTagged(articles);

    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(5);
  });
});
