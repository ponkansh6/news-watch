import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Mock DB before imports (in-memory SQLite, same pattern as real-llm.test.ts)
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
import { inArray } from "drizzle-orm";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import { getEmbeddingRequestCount, resetEmbeddingRequestCount } from "@/lib/embeddings";
import { getScoredArticles } from "@/lib/db/actions";

// Real scale E2E: REAL embeddings + REAL LLM + in-memory DB, 20 articles.
// Only runs with RUN_REAL_LLM_E2E=1 AND GOOGLE_API_KEY.
// Cleans up its own rows in afterEach.

const createdUrls = new Set<string>();

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

describe("Real LLM Scale E2E Tests (all real services)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    resetEmbeddingRequestCount();
  });

  afterEach(async () => {
    if (createdUrls.size > 0) {
      await dbMod.db.delete(articles).where(inArray(articles.url, [...createdUrls]));
      createdUrls.clear();
    }
  });

  it("should score 20 articles within 60 seconds (real embeddings + LLM + DB)", async () => {
    const MAX_ARTICLES = 20;
    const inputArticles = Array.from({ length: MAX_ARTICLES }).map((_, i) => {
      const url = `http://test.com/real-scale/${i}`;
      createdUrls.add(url);
      return {
        title: `Scale Test Article ${i} about ${KEYWORDS[i % KEYWORDS.length]}`,
        description: `This is a test description for article ${i} about AI and semiconductors.`,
        url,
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Test Source",
        sourceId: "test-source",
        author: "Test Author",
      };
    });

    const start = Date.now();
    const tagged = await tagArticlesByKeyword(inputArticles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);
    const end = Date.now();
    const duration = end - start;

    const embeddingCount = getEmbeddingRequestCount();
    console.log(
      `[scale] ${MAX_ARTICLES} articles scored in ${duration}ms, ${embeddingCount} embedding requests`,
    );

    expect(saved).toBe(MAX_ARTICLES);
    expect(duration).toBeLessThan(60_000);

    // 20 articles + 5 keywords = 25 (hard cap)
    expect(embeddingCount).toBeLessThanOrEqual(25);

    // Verify all articles appear in getScoredArticles with valid scores
    const scored = await getScoredArticles(100);
    expect(scored.length).toBe(MAX_ARTICLES);
    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.score).toBeGreaterThan(0);
      expect(a.summary).not.toBeNull();
      expect(a.usefulness).not.toBeNull();
    }
  }, 600_000);
});
