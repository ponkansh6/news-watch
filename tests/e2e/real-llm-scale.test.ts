import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";
const describeIfLive = RUN_LIVE ? describe : describe.skip;

// Mock DB before imports
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  const { createInMemoryDb } = await import("../helpers/db-setup");
  return createInMemoryDb();
});

import * as dbMod from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { getScoredArticles } from "@/lib/db";
import { CREATE_ARTICLES_TABLE_SQL } from "../helpers/db-setup";

const createdUrls = new Set<string>();

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_TABLE_SQL);
});

describeIfLive("Real LLM Scale E2E Tests (all real services)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    if (createdUrls.size > 0) {
      await dbMod.db.delete(articles).where(inArray(articles.url, [...createdUrls]));
      createdUrls.clear();
    }
  });

  it("should score 20 articles within 60 seconds (real LLM + DB)", async () => {
    const MAX_ARTICLES = 20;
    const inputArticles = Array.from({ length: MAX_ARTICLES }).map((_, i) => {
      const url = `http://test.com/real-scale/${i}`;
      createdUrls.add(url);
      return {
        title: `Scale Test Article ${i} about AI`,
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
    const saved = await scoreAndSaveTagged(inputArticles);
    const end = Date.now();
    const duration = end - start;

    console.log(`[scale] ${MAX_ARTICLES} articles scored in ${duration}ms`);

    expect(saved).toBe(MAX_ARTICLES);
    expect(duration).toBeLessThan(60_000);

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
