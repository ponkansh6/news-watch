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
  `);
});

describe.skipIf(!process.env.RUN_REAL_LLM_E2E || !process.env.GOOGLE_API_KEY)(
  "Real LLM E2E Tests (all real services)",
  () => {
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

    it("Tier G: Full production flow via real fetch-news (all sources, real news APIs, forced inline)", async () => {
      resetEmbeddingRequestCount();

      vi.stubEnv("QSTASH_TOKEN", "");
      const req = new NextRequest("http://localhost/api/fetch-news", {
        method: "POST",
        body: JSON.stringify({
          sources: ["newsapi", "qiita", "github", "yamadashy", "itmedia", "codezine"],
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await fetchNewsRoute(req);
      const data = await res.json();
      expect(res.status).toBe(200);

      const perSource = (data.perSource as any[]) ?? [];
      expect(
        perSource.some((p) => (p.fetched || 0) > 0),
        `all news sources returned 0 articles (perSource=${JSON.stringify(perSource)})`,
      ).toBe(true);

      const totalFetched = (data.results as any[]).reduce(
        (acc: number, r: any) => acc + (r.fetched || 0),
        0,
      );
      expect(totalFetched).toBeGreaterThan(0);

      const embeddingCount = getEmbeddingRequestCount();
      expect(embeddingCount).toBeLessThanOrEqual(25);

      lastFetchSince = (data.since as string) || null;

      vi.unstubAllEnvs();
    }, 120000);
  },
);
