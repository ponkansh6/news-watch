import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { scoreArticles } from "@/lib/llm/gemini";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { POST as scoreArticlesRoute } from "@/app/api/score-articles/route";
import { POST as scoringStatusRoute } from "@/app/api/scoring-status/route";
import { NextRequest } from "next/server";

// 1. Mock DB (In-memory)
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  return { db };
});

// 2. Mock Google Generative AI (for embeddings only; the LLM scoring path in
// `@/lib/llm/gemini` uses raw `fetch` and is NOT mocked, so it hits the real
// Gemini API).
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        embedContent: vi.fn(async () => ({
          embedding: { values: [0.1, 0.2, 0.3, 0.4] },
        })),
      };
    }
  },
  TaskType: {
    RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
    RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
  },
}));

// 3. Mock Config for Route Test
vi.mock("@/lib/config", () => ({
  KEYWORDS: ["TestKeyword"],
}));

// Only run when explicitly opted in AND a real API key is present, so the
// normal `pnpm test` / CI never triggers a paid network call.
describe.skipIf(!process.env.RUN_REAL_LLM_E2E || !process.env.GOOGLE_API_KEY)(
  "Real LLM E2E Tests",
  () => {
    beforeAll(async () => {
      await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
    });

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      await db.delete(articles);
    });

    it("Tier A: Single article scoring", async () => {
      const input = [{ title: "Test Title", description: "Test Description" }];
      const results = await scoreArticles(input, "TestKeyword");

      expect(results).toHaveLength(1);
      const res = results[0];
      expect(res).not.toBeNull();
      expect(res).toMatchObject({
        summary: expect.any(String),
        relevance: expect.any(Number),
        usefulness: expect.any(Number),
        reason: expect.any(String),
      });
      expect(res!.relevance).toBeGreaterThanOrEqual(0);
      expect(res!.relevance).toBeLessThanOrEqual(10);
    }, 70000);

    it("Tier B: Batch article scoring", async () => {
      const input = [
        { title: "T1", description: "D1" },
        { title: "T2", description: "D2" },
        { title: "T3", description: "D3" },
        { title: "T4", description: "D4" },
      ];
      const results = await scoreArticles(input, "TestKeyword");

      expect(results).toHaveLength(4);
      for (const res of results) {
        expect(res).not.toBeNull();
        expect(res!.summary.length).toBeGreaterThan(0);
      }
    }, 70000);

    it("Tier C: Pipeline integration", async () => {
      const tagged = [
        {
          article: {
            title: "Pipeline T1",
            description: "Pipeline D1",
            url: "http://test.com/1",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          embedding: [0.1, 0.2, 0.3, 0.4],
          keyword: "TestKeyword",
          similarity: 0.9,
        },
      ];

      const savedCount = await scoreAndSaveTagged(tagged);
      expect(savedCount).toBe(1);

      const allArticles = await db.select().from(articles);
      expect(allArticles).toHaveLength(1);
      expect(allArticles[0].score).not.toBeNull();
      expect(allArticles[0].summary).not.toBeNull();
    }, 70000);

    it("Tier D: API Route integration", async () => {
      const body = {
        articles: [
          {
            title: "Route T1",
            description: "Route D1",
            url: "http://test.com/r1",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "Route T2",
            description: "Route D2",
            url: "http://test.com/r2",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
        ],
      };

      const req = new NextRequest("http://localhost/api/score-articles", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const res = await scoreArticlesRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.saved).toBe(2);

      const statusReq = new NextRequest("http://localhost/api/scoring-status", {
        method: "POST",
        body: JSON.stringify({ keywords: ["TestKeyword"], since: "1970-01-01T00:00:00.000Z" }),
      });

      const statusRes = await scoringStatusRoute(statusReq);
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.status[0].scored).toBe(2);
      expect(statusData.status[0].processed).toBe(2);
    }, 70000);
  },
);
