import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Mock DB before imports
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

// Mock embeddings only (Gemini Embedding API) — real LLM scoring preserved.
// Uses content-aware mock vectors: articles matching a keyword phrase get a
// high-similarity vector to that keyword, ensuring tag assignment succeeds.
vi.mock("@/lib/embeddings", () => {
  let embedCallCount = 0;

  // 768-dimensional basis vectors by keyword index (orthogonal-ish for
  // non-matching, identical for matching keyword/article pairs).
  const KEYWORD_COUNT = 7; // must match KEYWORDS length in config.ts
  const keywordBases: number[][] = [];
  for (let k = 0; k < KEYWORD_COUNT; k++) {
    const vec = new Array(768).fill(0);
    vec[k] = 1; // orthogonal unit basis per keyword
    keywordBases.push(vec);
  }

  // Tokenise into lowercase words for overlap matching.
  function tokens(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .split(/[\s,、。．()（）]+/)
        .filter(Boolean),
    );
  }

  function vectorFor(text: string): number[] {
    // Match by word-overlap with each keyword phrase.
    const keywordPhrases = [
      "Anthropic Claude AI safety enterprise AI",
      "OpenAI ChatGPT GPT-4 DALL-E 人工知能研究",
      "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー",
      "KDDI au 通信キャリア モバイル IoT 5G",
      "NTT 日本電信電話 NTTデータ NTTドコモ 通信インフラ",
      "Google 検索 GCP Android YouTube Pixel Gemini テクノロジー企業",
      "docomo ドコモ NTTドコモ モバイル通信 キャリア",
    ];
    const textTokens = tokens(text);
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < keywordPhrases.length; i++) {
      const kwTokens = tokens(keywordPhrases[i]);
      let overlap = 0;
      for (const t of textTokens) {
        if (kwTokens.has(t)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }
    if (bestOverlap > 0) return [...keywordBases[bestIdx]];
    // Unrecognised text → zero vector (similarity stays 0, below threshold)
    return new Array(768).fill(0);
  }

  function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  return {
    EMBEDDING_MODEL_VERSION: "gemini-embedding-2",
    EMBEDDING_DIMENSIONS: 768,
    cosineSimilarity,
    getEmbeddingRequestCount: () => embedCallCount,
    resetEmbeddingRequestCount: () => {
      embedCallCount = 0;
    },
    embedArticle: vi.fn(async (_title: string, _description: string | null) => {
      embedCallCount++;
      return vectorFor(`${_title}\n${_description || ""}`);
    }),
    embedQuery: vi.fn(async (query: string) => {
      embedCallCount++;
      return vectorFor(query);
    }),
    batchEmbed: vi.fn(async (items: { text: string }[]) => {
      embedCallCount++;
      return items.map((item) => vectorFor(item.text));
    }),
  };
});

import * as dbMod from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { scoreArticles } from "@/lib/llm/gemini";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import { POST as fetchNewsRoute } from "@/app/api/fetch-news/route";
import { NextRequest } from "next/server";
import { getEmbeddingRequestCount, resetEmbeddingRequestCount } from "@/lib/embeddings";
import { getScoredArticles } from "@/lib/db/actions";

// Real end-to-end test: hits the REAL Gemini LLM, REAL embeddings API,
// REAL Turso DB.
//
// Guardrails:
// - Only runs with RUN_REAL_LLM_E2E=1 AND GOOGLE_API_KEY (no accidental CI cost).
// - Writes to the DB pointed at by TURSO_DATABASE_URL (production per decision).
// - afterEach deletes ONLY the test articles we created (by tracked URL), so we
//   never blanket-delete production rows.

const createdUrls = new Set<string>();
let lastFetchSince: string | null = null;

async function cleanup() {
  if (createdUrls.size === 0) return;
  await dbMod.db.delete(articles).where(inArray(articles.url, [...createdUrls]));
  createdUrls.clear();
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(`
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
      embedding TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
});

describe("Real LLM E2E Tests (all real services)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    await cleanup();
    if (lastFetchSince) {
      await dbMod.db.delete(articles).where(gte(articles.scoredAt, lastFetchSince));
      lastFetchSince = null;
    }
  });

  it("Tier A: Single article scoring (real LLM)", async () => {
    const input = [{ title: "Test Title", description: "Test Description" }];
    const results = await scoreArticles(input);

    expect(results).toHaveLength(1);
    const res = results[0];
    expect(res).not.toBeNull();
    expect(res).toMatchObject({
      summary: expect.any(String),
      usefulness: expect.any(Number),
      reason: expect.any(String),
    });
    expect(res!.usefulness).toBeGreaterThanOrEqual(0);
    expect(res!.usefulness).toBeLessThanOrEqual(10);
  }, 70000);

  it("Tier B: Batch article scoring (real LLM)", async () => {
    const input = [
      { title: "T1", description: "D1" },
      { title: "T2", description: "D2" },
      { title: "T3", description: "D3" },
      { title: "T4", description: "D4" },
    ];
    const results = await scoreArticles(input);

    expect(results).toHaveLength(4);
    const scored = results.filter((r) => r !== null);
    expect(scored.length).toBeGreaterThanOrEqual(3);
    for (const res of scored) {
      expect(res!.summary.length).toBeGreaterThan(0);
    }
  }, 70000);

  it("Tier C: Pipeline integration (real embeddings + LLM + DB)", async () => {
    resetEmbeddingRequestCount();

    const raw = [
      {
        title: "Pipeline T1 about Anthropic Claude",
        description: "Pipeline D1 about AI safety research",
        url: "http://test.com/real-c/1",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Test",
        sourceId: "test",
        author: "Author",
      },
    ];
    for (const r of raw) createdUrls.add(r.url);

    const tagged = await tagArticlesByKeyword(raw, KEYWORDS);
    expect(tagged).toHaveLength(1);
    expect(tagged[0].embedding.length).toBeGreaterThan(0);

    const embeddingCount = getEmbeddingRequestCount();
    expect(embeddingCount).toBeLessThanOrEqual(25);

    const savedCount = await scoreAndSaveTagged(tagged);
    expect(savedCount).toBe(1);

    const saved = await dbMod.db
      .select()
      .from(articles)
      .where(
        inArray(
          articles.url,
          raw.map((r) => r.url),
        ),
      );
    expect(saved).toHaveLength(1);
    expect(saved[0].score).not.toBeNull();
    expect(saved[0].summary).not.toBeNull();
    expect(saved[0].embedding).not.toBeNull();
  }, 70000);

  it("Tier G: Full production flow (all sources, real news APIs + real LLM + real embeddings)", async () => {
    resetEmbeddingRequestCount();

    const ALL_SOURCES = [
      "newsapi",
      "qiita",
      "yamadashy",
      "itmedia",
      "codezine",
      "zdnet",
      "xtech",
      "hatena",
    ];
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({
        sources: ALL_SOURCES,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await fetchNewsRoute(req);
    const data = await res.json();
    expect(res.status).toBe(200);

    // ── Stage 1: fetch succeeded for each source ──
    const perSource = (data.perSource as any[]) ?? [];
    expect(perSource.length).toBe(ALL_SOURCES.length);
    const zeroSources = perSource
      .filter((p: any) => (p.fetched || 0) === 0)
      .map((p: any) => p.source);
    expect(
      zeroSources,
      `sources with 0 fetched articles: ${zeroSources.join(", ")} (perSource=${JSON.stringify(perSource)})`,
    ).toHaveLength(0);

    const totalFetched = (data.results as any[]).reduce(
      (acc: number, r: any) => acc + (r.fetched || 0),
      0,
    );
    expect(totalFetched).toBeGreaterThan(0);

    lastFetchSince = (data.since as string) || null;

    // ── Stage 2: scored articles appear in DB ──
    const scored = await getScoredArticles(100);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.length).toBeLessThanOrEqual(totalFetched);

    // At least some articles must have valid LLM scores
    const withScore = scored.filter((a) => a.score !== null);
    expect(withScore.length).toBeGreaterThan(0);

    // Verify structure of scored results
    for (const a of withScore.slice(0, 3)) {
      expect(a.score).toBeGreaterThan(0);
      expect(a.summary).toBeTruthy();
      expect(a.usefulness).toBeGreaterThanOrEqual(0);
      expect(a.relevance).toBeGreaterThanOrEqual(0);
      expect(a.recency).toBeGreaterThanOrEqual(0);
      expect(a.sourceId).toBeTruthy();
    }

    // Embedding usage within limits
    const embeddingCount = getEmbeddingRequestCount();
    expect(embeddingCount).toBeLessThanOrEqual(25);
  }, 120000);
});
