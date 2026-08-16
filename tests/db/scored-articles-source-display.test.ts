/**
 * Reproduction test: "スコアリング後の絞り込み時に各ソースの記事が
 * スコアリング済み記事に表示されない"
 */
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";

// ── Mock DB (in-memory, isolated) ──────────────────────────────────
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

// ── Mock LLM ───────────────────────────────────────────────────────
const mockScoreArticles = vi.fn();
vi.mock("@/lib/llm", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
}));

// ── Imports (after mocks) ──────────────────────────────────────────
import * as dbMod from "@/lib/db";
import { getScoredArticles } from "@/lib/db";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import type { NormalizedArticle } from "@/lib/types";

// ── Fixtures ────────────────────────────────_______________________
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

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  mockScoreArticles.mockReset();
});

function makeArticles(count: number, sourceId: string, sourceName: string): NormalizedArticle[] {
  return Array.from({ length: count }).map((_, i) => ({
    title: `${sourceName} Article ${i}`,
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
        ntt_relevance: 8,
        reason: "関連",
      })),
  );
}

describe("Multi-source scored articles appear in unfiltered list", () => {
  it("all sources' articles are returned when no sourceIds filter", async () => {
    mockLlmSuccess();

    const sources = [
      { id: "zenn", name: "Zenn" },
      { id: "qiita", name: "Qiita" },
      { id: "github", name: "GitHub" },
      { id: "hatena", name: "Hatena" },
    ];

    for (const src of sources) {
      const articles = makeArticles(3, src.id, src.name);
      await scoreAndSaveTagged(articles);
    }

    const all = await getScoredArticles(100);
    expect(all).toHaveLength(12);

    const sourceIds = all.map((a) => a.sourceId);
    expect(sourceIds).toContain("zenn");
    expect(sourceIds).toContain("qiita");
    expect(sourceIds).toContain("github");
    expect(sourceIds).toContain("hatena");

    for (const a of all) {
      expect(a.score).not.toBeNull();
      expect(a.score!).toBeGreaterThan(0);
    }
  });
});

describe("Per-source filtering after scoring", () => {
  it("filtering by 'zenn' returns only zenn articles", async () => {
    mockLlmSuccess();

    const zennArticles = makeArticles(5, "zenn", "Zenn");
    const qiitaArticles = makeArticles(5, "qiita", "Qiita");
    const githubArticles = makeArticles(5, "github", "GitHub");

    for (const arts of [zennArticles, qiitaArticles, githubArticles]) {
      await scoreAndSaveTagged(arts);
    }

    const all = await getScoredArticles(100);
    expect(all).toHaveLength(15);

    const zennOnly = await getScoredArticles(100, ["zenn"]);
    expect(zennOnly).toHaveLength(5);
    for (const a of zennOnly) {
      expect(a.sourceId).toBe("zenn");
    }

    const qiitaOnly = await getScoredArticles(100, ["qiita"]);
    expect(qiitaOnly).toHaveLength(5);
    for (const a of qiitaOnly) {
      expect(a.sourceId).toBe("qiita");
    }

    const githubOnly = await getScoredArticles(100, ["github"]);
    expect(githubOnly).toHaveLength(5);
    for (const a of githubOnly) {
      expect(a.sourceId).toBe("github");
    }
  });

  it("filtering by multiple sources returns union", async () => {
    mockLlmSuccess();

    const zennArticles = makeArticles(3, "zenn", "Zenn");
    const qiitaArticles = makeArticles(3, "qiita", "Qiita");
    const githubArticles = makeArticles(3, "github", "GitHub");

    for (const arts of [zennArticles, qiitaArticles, githubArticles]) {
      await scoreAndSaveTagged(arts);
    }

    const filtered = await getScoredArticles(100, ["zenn", "github"]);
    expect(filtered).toHaveLength(6);
    const sourceIds = filtered.map((a) => a.sourceId);
    expect(sourceIds).toContain("zenn");
    expect(sourceIds).toContain("github");
    expect(sourceIds).not.toContain("qiita");
  });
});

describe("Non-matching source filter", () => {
  it("filtering by non-existent source returns 0", async () => {
    mockLlmSuccess();

    const articles = makeArticles(5, "zenn", "Zenn");
    await scoreAndSaveTagged(articles);

    const result = await getScoredArticles(100, ["nonexistent"]);
    expect(result).toHaveLength(0);
  });
});

describe("Low-score articles with valid source appear in filtered results", () => {
  it("articles with non-null scores from specific source are returned", async () => {
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "極低",
          usefulness: 0,
          ntt_relevance: 1,
          reason: "低い",
        })),
    );

    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const zennArticles = Array.from({ length: 3 }).map((_, i) => ({
      title: `Old Zenn Article ${i}`,
      description: `Old description ${i}`,
      url: `http://test.com/old-zenn/${i}`,
      urlToImage: null,
      publishedAt: oldDate,
      sourceName: "Zenn",
      sourceId: "zenn",
      author: `Author ${i}`,
    }));

    await scoreAndSaveTagged(zennArticles);

    const zennOnly = await getScoredArticles(100, ["zenn"]);
    expect(zennOnly).toHaveLength(3);
    for (const a of zennOnly) {
      expect(a.sourceId).toBe("zenn");
      expect(a.score).not.toBeNull();
    }
  });
});
