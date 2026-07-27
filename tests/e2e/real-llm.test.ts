import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Mock DB before imports
vi.mock("@/lib/db", async () => {
  const { createInMemoryDb } = await import("../helpers/db-setup");
  return createInMemoryDb();
});

// Mock embeddings
vi.mock("@/lib/embeddings", async () => {
  const { createEmbeddingsMock } = await import("../helpers/embeddings-mock");
  return createEmbeddingsMock();
});

// Mock LLM - returns deterministic scored results
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi
    .fn()
    .mockImplementation((articles: { title: string; description: string | null }[]) =>
      Promise.resolve(
        articles.map(() => ({
          summary: "Mocked summary",
          usefulness: 7,
          reason: "Mocked reason",
        })),
      ),
    ),
  scoreArticle: vi.fn().mockResolvedValue({
    summary: "Mocked summary",
    usefulness: 7,
    reason: "Mocked reason",
  }),
  LLM_MODEL: "mocked",
}));

import * as dbMod from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { scoreArticles } from "@/lib/llm/gemini";
import { POST as fetchNewsRoute } from "@/app/api/fetch-news/route";
import { NextRequest } from "next/server";
import { CREATE_ARTICLES_TABLE_SQL } from "../helpers/db-setup";

let lastFetchSince: string | null = null;

async function cleanup() {
  if (lastFetchSince) {
    await dbMod.db.delete(articles).where(gte(articles.scoredAt, lastFetchSince));
    lastFetchSince = null;
  }
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_TABLE_SQL);
});

describe("Real LLM E2E Tests (mocked LLM)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    await cleanup();
  });

  it("Tier A: Single article scoring (mocked)", async () => {
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
  }, 10000);

  it("Tier B: Batch article scoring (mocked)", async () => {
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
  }, 10000);

  it("Tier D: API Route integration (fetch-news, mocked LLM)", async () => {
    const req = new NextRequest("http://localhost:3000/api/fetch-news", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
    });

    const res = await fetchNewsRoute(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("ok", true);
  }, 30000);
});
