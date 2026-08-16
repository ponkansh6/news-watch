import { describe, expect, test, vi, beforeEach } from "vitest";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Mock @/lib/llm
vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn(async (articlesToScore) => {
    return articlesToScore.map((a: { title: string }) => {
      if (a.title.includes("NullUsefulness")) {
        return {
          summary: "Summary for null usefulness",
          usefulness: null,
          ntt_relevance: 5,
          reason: "Test reason",
        };
      }
      if (a.title.includes("LowRelevance")) {
        return {
          summary: "Summary for " + a.title,
          usefulness: 8,
          ntt_relevance: 7,
          reason: "Test reason 3",
        };
      }
      return {
        summary: "Summary for " + a.title,
        usefulness: 8,
        ntt_relevance: 9,
        reason: "Test reason 2",
      };
    });
  }),
}));

describe("score-pipeline with LLM relevance", () => {
  beforeEach(async () => {});

  test("scoreAndSaveTagged tags NTT only when ntt_relevance >= threshold (8)", async () => {
    const rawArticles = [
      {
        title: "Test Article Cloud",
        description: "Cloud computing desc",
        url: "https://example.com/cloud-article",
        urlToImage: null,
        publishedAt: "2026-08-15T00:00:00Z",
        sourceName: "TestSrc",
        sourceId: "test-src",
        author: null,
      },
      {
        title: "Test Article NullUsefulness",
        description: "Null usefulness desc",
        url: "https://example.com/null-usefulness",
        urlToImage: null,
        publishedAt: "2026-08-15T00:00:00Z",
        sourceName: "TestSrc",
        sourceId: "test-src",
        author: null,
      },
      {
        title: "Test Article LowRelevance",
        description: "Low relevance desc",
        url: "https://example.com/low-relevance",
        urlToImage: null,
        publishedAt: "2026-08-15T00:00:00Z",
        sourceName: "TestSrc",
        sourceId: "test-src",
        author: null,
      },
    ];

    await scoreAndSaveTagged(rawArticles);

    // ntt_relevance=9 (>= 8) -> tagged "NTT"
    const savedCloud = await db.query.articles.findFirst({
      where: eq(articles.url, "https://example.com/cloud-article"),
    });

    expect(savedCloud).toBeDefined();
    expect(savedCloud?.relevance).toBe(9);
    expect(savedCloud?.keyword).toBe("NTT");
    expect(savedCloud?.score).not.toBeNull();

    // ntt_relevance=5 (< 8) -> not tagged, even though usefulness is null
    const savedNull = await db.query.articles.findFirst({
      where: eq(articles.url, "https://example.com/null-usefulness"),
    });

    expect(savedNull).toBeDefined();
    expect(savedNull?.relevance).toBe(5);
    expect(savedNull?.keyword).toBeNull();
    expect(savedNull?.score).toBeNull(); // usefulness is null -> score is null

    // ntt_relevance=7 (just below threshold) -> not tagged
    const savedLow = await db.query.articles.findFirst({
      where: eq(articles.url, "https://example.com/low-relevance"),
    });

    expect(savedLow).toBeDefined();
    expect(savedLow?.relevance).toBe(7);
    expect(savedLow?.keyword).toBeNull();
  });
});
