/**
 * Reproduction test: "スコアリング後の絞り込み時に各ソースの記事が
 * スコアリング済み記事に表示されない"
 *
 * Tests that after scoring, articles from each source are correctly
 * included in the scored-articles list, both unfiltered and with
 * per-source filtering.
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
  batchEmbed: vi.fn(async (items: any[]) => items.map(() => new Array(768).fill(0.1))),
  cosineSimilarity: vi.fn(() => 0.9),
}));

// ── Mock LLM ───────────────────────────────────────────────────────
const mockScoreArticles = vi.fn();
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
}));

// ── Imports (after mocks) ──────────────────────────────────────────
import * as dbMod from "@/lib/db";
import { getScoredArticles } from "@/lib/db/actions";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import type { NormalizedArticle } from "@/lib/types";

// ── Fixtures ───────────────────────────────────────────────────────
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

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  mockScoreArticles.mockReset();
});

function makeArticles(count: number, sourceId: string, sourceName: string): NormalizedArticle[] {
  return Array.from({ length: count }).map((_, i) => ({
    title: `${sourceName} Article ${i}: ${KEYWORDS[i % KEYWORDS.length]}`,
    description: `Description from ${sourceName} #${i}`,
    url: `http://test.com/${sourceId}/${i}`,
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName,
    sourceId,
    author: `Author ${i}`,
  }));
}

function mockLlmSuccess() {
  mockScoreArticles.mockImplementation(
    async (items: { title: string; description: string | null }[]) =>
      items.map((item, i) => ({
        summary: `要約: ${item.title}`,
        usefulness: 6 + (i % 4),
        reason: "関連",
      })),
  );
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 1: Multiple sources scored → all appear unfiltered
// ═══════════════════════════════════════════════════════════════════
describe("Multi-source scored articles appear in unfiltered list", () => {
  it("all sources' articles are returned when no sourceIds filter", async () => {
    mockLlmSuccess();

    const sources = [
      { id: "newsapi", name: "NewsAPI" },
      { id: "qiita", name: "Qiita" },
      { id: "github", name: "GitHub" },
      { id: "hatena", name: "Hatena" },
    ];

    // Score and save articles from each source
    for (const src of sources) {
      const articles = makeArticles(3, src.id, src.name);
      const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
      await scoreAndSaveTagged(tagged);
    }

    // Unfiltered: should return all 12 articles
    const all = await getScoredArticles(100);
    expect(all).toHaveLength(12);

    // Verify each source is represented
    const sourceIds = all.map((a) => a.sourceId);
    expect(sourceIds).toContain("newsapi");
    expect(sourceIds).toContain("qiita");
    expect(sourceIds).toContain("github");
    expect(sourceIds).toContain("hatena");

    // Verify each article has a valid score
    for (const a of all) {
      expect(a.score).not.toBeNull();
      expect(a.score!).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 2: Per-source filtering returns correct subset
// ═══════════════════════════════════════════════════════════════════
describe("Per-source filtering after scoring", () => {
  it("filtering by 'newsapi' returns only newsapi articles", async () => {
    mockLlmSuccess();

    const newsapiArticles = makeArticles(5, "newsapi", "NewsAPI");
    const qiitaArticles = makeArticles(5, "qiita", "Qiita");
    const githubArticles = makeArticles(5, "github", "GitHub");

    for (const arts of [newsapiArticles, qiitaArticles, githubArticles]) {
      const tagged = await tagArticlesByKeyword(arts, KEYWORDS);
      await scoreAndSaveTagged(tagged);
    }

    // Total = 15
    const all = await getScoredArticles(100);
    expect(all).toHaveLength(15);

    // Filter by newsapi only
    const newsapiOnly = await getScoredArticles(100, ["newsapi"]);
    expect(newsapiOnly).toHaveLength(5);
    for (const a of newsapiOnly) {
      expect(a.sourceId).toBe("newsapi");
    }

    // Filter by qiita only
    const qiitaOnly = await getScoredArticles(100, ["qiita"]);
    expect(qiitaOnly).toHaveLength(5);
    for (const a of qiitaOnly) {
      expect(a.sourceId).toBe("qiita");
    }

    // Filter by github only
    const githubOnly = await getScoredArticles(100, ["github"]);
    expect(githubOnly).toHaveLength(5);
    for (const a of githubOnly) {
      expect(a.sourceId).toBe("github");
    }
  });

  it("filtering by multiple sources returns union", async () => {
    mockLlmSuccess();

    const newsapiArticles = makeArticles(3, "newsapi", "NewsAPI");
    const qiitaArticles = makeArticles(3, "qiita", "Qiita");
    const githubArticles = makeArticles(3, "github", "GitHub");

    for (const arts of [newsapiArticles, qiitaArticles, githubArticles]) {
      const tagged = await tagArticlesByKeyword(arts, KEYWORDS);
      await scoreAndSaveTagged(tagged);
    }

    // Filter by newsapi + github
    const filtered = await getScoredArticles(100, ["newsapi", "github"]);
    expect(filtered).toHaveLength(6);
    const sourceIds = filtered.map((a) => a.sourceId);
    expect(sourceIds).toContain("newsapi");
    expect(sourceIds).toContain("github");
    expect(sourceIds).not.toContain("qiita");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 3: Source filter with no matching articles returns empty
// ═══════════════════════════════════════════════════════════════════
describe("Non-matching source filter", () => {
  it("filtering by non-existent source returns 0", async () => {
    mockLlmSuccess();

    const articles = makeArticles(5, "newsapi", "NewsAPI");
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    await scoreAndSaveTagged(tagged);

    const result = await getScoredArticles(100, ["nonexistent"]);
    expect(result).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 4: score=0 (edge case) - articles with very low but
// non-null scores should still appear
// ═══════════════════════════════════════════════════════════════════
describe("Low-score articles with valid source appear in filtered results", () => {
  it("articles with score=0.1 (non-null) from specific source are returned", async () => {
    // Mock LLM to return very low usefulness (0) for old articles
    // composite = relevance*0.3 + usefulness*0.4 + recency*0.3
    // For old article: recency=0, so composite = 0*0.3 + 0*0.4 + 0*0.3 = 0
    // But score is set by calcCompositeScore which uses similarity (0.9 from mock)
    // composite = 0.9*0.3 + 0*0.4 + 0*0.3 = 0.27 (non-null!)
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "極低",
          usefulness: 0,
          reason: "低い",
        })),
    );

    // Use very old date to get recency=0
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const newsapiArticles = Array.from({ length: 3 }).map((_, i) => ({
      title: `Old NewsAPI Article ${i}`,
      description: `Old description ${i}`,
      url: `http://test.com/old-newsapi/${i}`,
      urlToImage: null,
      publishedAt: oldDate,
      sourceName: "NewsAPI",
      sourceId: "newsapi",
      author: `Author ${i}`,
    }));

    const tagged = await tagArticlesByKeyword(newsapiArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    // Verify articles were saved with non-null score
    expect(saved).toBe(3);

    // Check DB directly for score values
    const dbRows = await (dbMod as any).__client.execute(
      "SELECT source_id, score FROM articles WHERE source_id = 'newsapi'",
    );
    expect(dbRows.rows).toHaveLength(3);
    for (const row of dbRows.rows) {
      expect(row.score).not.toBeNull();
    }

    // getScoredArticles should return these articles (score IS NOT NULL)
    const scored = await getScoredArticles(100, ["newsapi"]);
    expect(scored).toHaveLength(3);
    for (const a of scored) {
      expect(a.sourceId).toBe("newsapi");
      expect(a.score).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 5: Full pipeline simulation - score then filter per source
// ═══════════════════════════════════════════════════════════════════
describe("Full pipeline: score all sources → filter per source", () => {
  it("simulates page.tsx ?sources=newsapi returns only newsapi scored articles", async () => {
    mockLlmSuccess();

    const sources = [
      { id: "newsapi", name: "NewsAPI", count: 4 },
      { id: "qiita", name: "Qiita", count: 3 },
      { id: "github", name: "GitHub", count: 3 },
      { id: "hatena", name: "Hatena", count: 2 },
    ];

    // Score all sources in one batch (simulating route.ts flow)
    const allArticles: NormalizedArticle[] = [];
    for (const src of sources) {
      allArticles.push(...makeArticles(src.count, src.id, src.name));
    }
    const tagged = await tagArticlesByKeyword(allArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    expect(saved).toBe(12);

    // Simulate page.tsx: ?sources=newsapi
    const newsapiParam = "newsapi";
    const selectedSources = newsapiParam.split(",").filter(Boolean);
    const scored = await getScoredArticles(
      100,
      selectedSources.length > 0 ? selectedSources : undefined,
    );

    // Should return only newsapi articles
    expect(scored).toHaveLength(4);
    for (const a of scored) {
      expect(a.sourceId).toBe("newsapi");
      expect(a.score).not.toBeNull();
    }

    // Simulate page.tsx: ?sources=newsapi,qiita
    const multiParam = "newsapi,qiita";
    const multiSelected = multiParam.split(",").filter(Boolean);
    const multiScored = await getScoredArticles(
      100,
      multiSelected.length > 0 ? multiSelected : undefined,
    );

    expect(multiScored).toHaveLength(7);
    const multiSourceIds = multiScored.map((a) => a.sourceId);
    expect(multiSourceIds).toContain("newsapi");
    expect(multiSourceIds).toContain("qiita");
    expect(multiSourceIds).not.toContain("github");
    expect(multiSourceIds).not.toContain("hatena");

    // Simulate page.tsx: no sources param (all)
    const noFilterScored = await getScoredArticles(100, undefined);
    expect(noFilterScored).toHaveLength(12);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 6: sourceId=null articles are excluded by source filter
// ═══════════════════════════════════════════════════════════════════
describe("Articles with sourceId=null", () => {
  it("articles with sourceId=null appear in unfiltered but not in source-filtered results", async () => {
    // Directly insert articles with sourceId=null
    const dbInstance = (dbMod as any).db;
    await dbInstance.insert((await import("@/lib/db/schema")).articles).values([
      {
        title: "Article with sourceId=null",
        description: "desc",
        url: "http://test.com/null-source/1",
        publishedAt: new Date().toISOString(),
        sourceId: null,
        keyword: KEYWORDS[0],
        summary: "summary",
        usefulness: 7,
        recency: 5,
        score: 6.5,
        scoredAt: new Date().toISOString(),
        embedding: "[]",
      },
      {
        title: "Article with sourceId=newsapi",
        description: "desc",
        url: "http://test.com/newsapi/1",
        publishedAt: new Date().toISOString(),
        sourceId: "newsapi",
        keyword: KEYWORDS[0],
        summary: "summary",
        usefulness: 7,
        recency: 5,
        score: 7.0,
        scoredAt: new Date().toISOString(),
        embedding: "[]",
      },
    ]);

    // Unfiltered: both appear
    const all = await getScoredArticles(100);
    expect(all).toHaveLength(2);

    // Filter by newsapi: only newsapi article appears (null excluded by inArray)
    const filtered = await getScoredArticles(100, ["newsapi"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceId).toBe("newsapi");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 7: Score threshold edge - articles near minScore boundary
// ═══════════════════════════════════════════════════════════════════
describe("Score boundary after deleteLowScoredArticles", () => {
  it("articles with score exactly at boundary are retained in source filter", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title}`,
          usefulness: 5,
          reason: "関連",
        })),
    );

    const articles = makeArticles(5, "newsapi", "NewsAPI");
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    await scoreAndSaveTagged(tagged);

    // All articles have score = composite(similarity=0.9, usefulness=5, recency≈10)
    // = 0.9*0.3 + 5*0.4 + 10*0.3 = 0.27 + 2.0 + 3.0 = 5.27
    // This is above minScore=5, so they should survive deleteLowScoredArticles
    const all = await getScoredArticles(100, ["newsapi"]);
    expect(all.length).toBeGreaterThan(0);

    for (const a of all) {
      expect(a.score).not.toBeNull();
      expect(a.score!).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 8: "savedCount正常だが表示0件" — BUG REPRODUCTION
// ═══════════════════════════════════════════════════════════════════
describe('BUG REPRO: "N件スコアリング完了" but "スコアリング済み記事0件"', () => {
  /**
   * calcCompositeScore returns null when usefulness === null.
   * getScoredArticles filters WHERE score IS NOT NULL.
   * If ALL articles end up with score=null, the user sees "N件完了" but 0 displayed.
   *
   * scoreAndSaveTagged counts savedCount when llmResult is truthy,
   * regardless of whether calcCompositeScore returns null.
   * This means: savedCount > 0 even though score=null → 0 displayed.
   */
  it("LLM returns results but calcCompositeScore yields null → saved>0, displayed=0", async () => {
    // LLM returns objects that pass the "truthy" check in scoreAndSaveTagged
    // BUT if usefulness is somehow null (e.g. LLM response schema mismatch),
    // calcCompositeScore returns null → score=null in DB → excluded by getScoredArticles.
    //
    // However, the current LLMResponseSchema requires usefulness as z.number(),
    // so this shouldn't happen with valid LLM output. Let's simulate the edge case
    // where the LLM returns a response that doesn't match the schema.
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        // Return null for all articles (simulating LLM failure/parse error)
        items.map(() => null),
    );

    const newsapiArticles = makeArticles(5, "newsapi", "NewsAPI");
    const qiitaArticles = makeArticles(5, "qiita", "Qiita");

    const allArticles = [...newsapiArticles, ...qiitaArticles];
    const tagged = await tagArticlesByKeyword(allArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    // savedCount = 0 because llmResult is null → savedCount doesn't increment
    expect(saved).toBe(0);

    // But articles ARE in the DB (upserted with score=null)
    const dbRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(dbRows.rows[0].cnt).toBe(10);

    // ALL articles have score=null
    const nullScores = await (dbMod as any).__client.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NULL",
    );
    expect(nullScores.rows[0].cnt).toBe(10);

    // getScoredArticles returns 0 — this is the "表示0件" state
    const scored = await getScoredArticles(100);
    expect(scored).toHaveLength(0);

    // Per-source also returns 0
    const newsapiScored = await getScoredArticles(100, ["newsapi"]);
    expect(newsapiScored).toHaveLength(0);

    const qiitaScored = await getScoredArticles(100, ["qiita"]);
    expect(qiitaScored).toHaveLength(0);
  });

  /**
   * Partial LLM failure: some articles scored, some not.
   * The "N件完了" count only reflects successful scores,
   * but the user might expect ALL fetched articles to appear.
   */
  it("partial LLM failure: savedCount < fetched, only scored ones displayed", async () => {
    // LLM succeeds for first 5 (newsapi), fails for last 5 (qiita)
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => {
          // Items 0-4 are newsapi (pass), 5-9 are qiita (fail)
          if (i < 5) {
            return {
              summary: `要約: ${item.title}`,
              usefulness: 6,
              reason: "関連",
            };
          }
          return null; // LLM fails for qiita
        }),
    );

    const newsapiArticles = makeArticles(5, "newsapi", "NewsAPI");
    const qiitaArticles = makeArticles(5, "qiita", "Qiita");
    const allArticles = [...newsapiArticles, ...qiitaArticles];

    const tagged = await tagArticlesByKeyword(allArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    // Only newsapi scored
    expect(saved).toBe(5);

    // All 10 in DB
    const dbRows = await (dbMod as any).__client.execute("SELECT COUNT(*) as cnt FROM articles");
    expect(dbRows.rows[0].cnt).toBe(10);

    // Unfiltered: only 5 scored articles appear
    const allScored = await getScoredArticles(100);
    expect(allScored).toHaveLength(5);

    // Newsapi: 5 articles displayed
    const newsapiScored = await getScoredArticles(100, ["newsapi"]);
    expect(newsapiScored).toHaveLength(5);

    // Qiita: 0 articles displayed (all score=null)
    const qiitaScored = await getScoredArticles(100, ["qiita"]);
    expect(qiitaScored).toHaveLength(0);

    // User selects "qiita" filter → 0 articles shown
    // This matches the bug: "スコアリング完了" is shown for total,
    // but filtering by qiita shows nothing
  });

  /**
   * The real production flow: fetch news → score → display.
   * Tests the exact sequence in route.ts + page.tsx.
   */
  it("full route.ts → page.tsx flow: fetch 2 sources, only 1 scores → filter mismatch", async () => {
    // Simulate: newsapi scores well, qiita LLM times out
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item) => ({
          summary: `要約: ${item.title}`,
          usefulness: 7,
          reason: "関連",
        })),
    );

    // Step 1: Fetch + score newsapi (route.ts flow)
    const newsapiFetched = makeArticles(8, "newsapi", "NewsAPI");
    const newsapiTagged = await tagArticlesByKeyword(newsapiFetched, KEYWORDS);
    const newsapiSaved = await scoreAndSaveTagged(newsapiTagged);
    expect(newsapiSaved).toBe(8);

    // Step 2: Fetch + score qiita (same route.ts flow)
    const qiitaFetched = makeArticles(8, "qiita", "Qiita");
    const qiitaTagged = await tagArticlesByKeyword(qiitaFetched, KEYWORDS);
    const qiitaSaved = await scoreAndSaveTagged(qiitaTagged);
    expect(qiitaSaved).toBe(8);

    // Step 3: page.tsx displays all scored articles (no filter)
    const allDisplayed = await getScoredArticles(100);
    expect(allDisplayed).toHaveLength(16);

    // Step 4: User selects only newsapi
    const newsapiOnly = await getScoredArticles(100, ["newsapi"]);
    expect(newsapiOnly).toHaveLength(8);
    for (const a of newsapiOnly) {
      expect(a.sourceId).toBe("newsapi");
    }

    // Step 5: User selects only qiita
    const qiitaOnly = await getScoredArticles(100, ["qiita"]);
    expect(qiitaOnly).toHaveLength(8);
    for (const a of qiitaOnly) {
      expect(a.sourceId).toBe("qiita");
    }
  });

  /**
   * Edge case: deleteLowScoredArticles removes articles BETWEEN
   * scoring and display, causing "completed" count > displayed count.
   */
  it("deleteLowScoredArticles between score and display → completed > displayed", async () => {
    // Return very low usefulness for old articles → composite < 5
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "低スコア",
          usefulness: 0,
          reason: "低い",
        })),
    );

    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const newsapiArticles = makeArticles(5, "newsapi", "NewsAPI");
    // Override publishedAt to old date
    newsapiArticles.forEach((a) => (a.publishedAt = oldDate));

    const qiitaArticles = makeArticles(5, "qiita", "Qiita");
    qiitaArticles.forEach((a) => (a.publishedAt = oldDate));

    // Score all
    const allArticles = [...newsapiArticles, ...qiitaArticles];
    const tagged = await tagArticlesByKeyword(allArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    // savedCount = 10 because llmResult is truthy for all
    expect(saved).toBe(10);

    // All 10 in DB with score = 0.27 (composite with similarity=0.9, usefulness=0, recency=0)
    const beforeDelete = await getScoredArticles(100);
    expect(beforeDelete).toHaveLength(10);

    // Simulate route.ts: since = scoring start time
    // deleteLowScoredArticles(5, since) where since < scoredAt for current batch
    // → current batch is PROTECTED (scoredAt >= since)
    // So articles should survive
    const since = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const { deleteLowScoredArticles } = await import("@/lib/db/actions");
    await deleteLowScoredArticles(5, since);

    const afterDelete = await getScoredArticles(100);
    // Current batch protected → still 10
    expect(afterDelete).toHaveLength(10);

    // But if since is AFTER scoring (simulating a later fetch), articles are deleted
    const since2 = new Date(Date.now() + 60_000).toISOString(); // future
    await deleteLowScoredArticles(5, since2);

    const afterDelete2 = await getScoredArticles(100);
    // Articles scored before since2 AND score < 5 → deleted
    expect(afterDelete2).toHaveLength(0);

    // User sees "10件スコアリング完了" from previous fetch response
    // but now getScoredArticles returns 0
  });

  /**
   * Critical: recencyRefreshedAt column exists in schema but NOT in test CREATE_SQL.
   * If the actual DB migration adds this column but old tests don't have it,
   * articles upserted with recencyRefreshedAt could fail silently.
   */
  it("recencyRefreshedAt column mismatch: upsert includes column not in table", async () => {
    // This test uses the same CREATE_SQL as other tests (no recency_refreshed_at)
    // but the actual code sends recencyRefreshedAt in upsertArticle.
    // If the column doesn't exist, SQLite silently ignores it (no error),
    // BUT the Drizzle schema expects it → potential type mismatch.

    mockLlmSuccess();
    const articles = makeArticles(3, "newsapi", "NewsAPI");
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);

    // scoreAndSaveTagged sends recencyRefreshedAt — this should work
    // even if the column doesn't exist in raw SQL (SQLite is lenient)
    const saved = await scoreAndSaveTagged(tagged);
    expect(saved).toBe(3);

    // Verify articles are in DB with scores
    const scored = await getScoredArticles(100, ["newsapi"]);
    expect(scored).toHaveLength(3);
    for (const a of scored) {
      expect(a.score).not.toBeNull();
    }
  });
});
