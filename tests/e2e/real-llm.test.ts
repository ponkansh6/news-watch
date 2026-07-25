import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Mock DB before imports
vi.mock("@/lib/db", async () => {
  const { createInMemoryDb } = await import("../helpers/db-setup");
  return createInMemoryDb();
});

// Mock embeddings only (Gemini Embedding API)
vi.mock("@/lib/embeddings", async () => {
  const { createEmbeddingsMock } = await import("../helpers/embeddings-mock");
  return createEmbeddingsMock();
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
import { CREATE_ARTICLES_TABLE_SQL } from "../helpers/db-setup";

const createdUrls = new Set<string>();
let lastFetchSince: string | null = null;

async function cleanup() {
  if (createdUrls.size === 0) return;
  await dbMod.db.delete(articles).where(inArray(articles.url, [...createdUrls]));
  createdUrls.clear();
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_TABLE_SQL);
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
    for (const res of results) {
      expect(res).not.toBeNull();
      expect(res!.usefulness).toBeGreaterThanOrEqual(0);
    }
  }, 90000);

  it("Tier C: Full pipeline execution with vector filtering", async () => {
    resetEmbeddingRequestCount();

    const mockArticles = KEYWORDS.map((kw, i) => ({
      title: `${kw} Breakthrough Update ${i}`,
      description: `New advancements in ${kw} announced today with major enterprise impacts.`,
      url: `https://example.com/e2e-news-${i}-${Date.now()}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "TechNews",
      sourceId: "technews",
      author: "Editor",
    }));

    for (const a of mockArticles) {
      createdUrls.add(a.url);
    }

    const tagged = await tagArticlesByKeyword(mockArticles, KEYWORDS);
    expect(tagged.length).toBeGreaterThan(0);

    const savedCount = await scoreAndSaveTagged(tagged);
    expect(savedCount).toBeGreaterThan(0);

    const scoredFromDb = await getScoredArticles();
    expect(scoredFromDb.length).toBeGreaterThan(0);
    expect(getEmbeddingRequestCount()).toBeGreaterThan(0);
  }, 120000);

  it("Tier D: API Route integration (fetch-news)", async () => {
    const req = new NextRequest("http://localhost:3000/api/fetch-news", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
    });

    const res = await fetchNewsRoute(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("success", true);
  }, 120000);
});
