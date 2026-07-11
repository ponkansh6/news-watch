import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { POST as scoreArticlesRoute } from "@/app/api/score-articles/route";
import { KEYWORDS } from "@/lib/config";
import { NextRequest } from "next/server";

// Real scale E2E: REAL embeddings + REAL LLM + REAL Turso DB, 20 articles.
// Only runs with RUN_REAL_LLM_E2E=1 AND GOOGLE_API_KEY.
// Writes to TURSO_DATABASE_URL (production per decision); cleans up its own rows.

const createdUrls = new Set<string>();

describe.skipIf(!process.env.RUN_REAL_LLM_E2E || !process.env.GOOGLE_API_KEY)(
  "Real LLM Scale E2E Tests (all real services)",
  () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      if (createdUrls.size > 0) {
        await db.delete(articles).where(inArray(articles.url, [...createdUrls]));
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

      const body = { articles: inputArticles };
      const req = new NextRequest("http://localhost/api/score-articles", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const start = Date.now();
      const res = await scoreArticlesRoute(req);
      const end = Date.now();
      const duration = end - start;

      console.log(`[scale] ${MAX_ARTICLES} articles scored in ${duration}ms`);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.saved).toBe(MAX_ARTICLES);
      expect(duration).toBeLessThan(60_000);
    }, 600_000);
  },
);
