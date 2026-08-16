/**
 * Tier C: Full pipeline test with REAL LLM calls.
 * Only runs when RUN_LIVE_TESTS=1 to avoid quota exhaustion in CI.
 * This is the single most important integration test — it validates
 * vector tagging → LLM scoring → DB persistence end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Skip unless RUN_LIVE_TESTS=1
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

async function cleanup() {
  if (createdUrls.size === 0) return;
  await dbMod.db.delete(articles).where(inArray(articles.url, [...createdUrls]));
  createdUrls.clear();
}

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_TABLE_SQL);
});

describeIfLive("Tier C: Full pipeline (real LLM)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    await cleanup();
  });

  it("LLM score → DB persist", async () => {
    const mockArticles = [
      {
        title: "AI Breakthrough Update 1",
        description: "New advancements in AI announced today with major enterprise impacts.",
        url: `https://example.com/e2e-news-1-${Date.now()}`,
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "TechNews",
        sourceId: "technews",
        author: "Editor",
      },
    ];

    for (const a of mockArticles) {
      createdUrls.add(a.url);
    }

    const savedCount = await scoreAndSaveTagged(mockArticles);
    expect(savedCount).toBeGreaterThan(0);

    const scoredFromDb = await getScoredArticles();
    expect(scoredFromDb.length).toBeGreaterThan(0);
  }, 120000);
});
