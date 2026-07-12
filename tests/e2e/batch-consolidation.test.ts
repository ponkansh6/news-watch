/**
 * E2E test: LLM batch consolidation.
 *
 * Verifies that with LLM_BATCH_SIZE = 20, articles sharing a keyword are scored
 * in a single LLM call instead of being split into many small batches.
 * Exercises the real scoreAndSaveTagged pipeline.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import * as gemini from "@/lib/llm/gemini";
import * as db from "@/lib/db/actions";

const { mockScoreArticles } = vi.hoisted(() => ({ mockScoreArticles: vi.fn() }));
const { mockUpsertArticle } = vi.hoisted(() => ({ mockUpsertArticle: vi.fn() }));
const { mockEmbedArticle } = vi.hoisted(() => ({ mockEmbedArticle: vi.fn() }));
const { mockEmbedQuery } = vi.hoisted(() => ({ mockEmbedQuery: vi.fn() }));
const { mockBatchEmbed } = vi.hoisted(() => ({ mockBatchEmbed: vi.fn() }));
const { mockCosineSimilarity } = vi.hoisted(() => ({ mockCosineSimilarity: vi.fn() }));

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: mockScoreArticles,
}));

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: mockUpsertArticle,
}));

vi.mock("@/lib/embeddings", () => ({
  embedArticle: mockEmbedArticle,
  embedQuery: mockEmbedQuery,
  batchEmbed: mockBatchEmbed,
  cosineSimilarity: mockCosineSimilarity,
}));

vi.mock("@/lib/config", () => ({
  KEYWORDS: ["Anthropic"],
}));

function makeArticle(url: string) {
  return {
    title: `Article ${url}`,
    description: "desc",
    url,
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Test",
    sourceId: "test",
    author: null,
  };
}

describe("e2e: batch consolidation (20-in-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) =>
        Promise.resolve(articles.map(() => ({ summary: "s", usefulness: 7, reason: "r" }))),
    );
    mockUpsertArticle.mockResolvedValue(undefined);
    mockEmbedArticle.mockResolvedValue([0.1, 0.2]);
    mockEmbedQuery.mockResolvedValue([0.1, 0.2]);
    mockBatchEmbed.mockImplementation((items) => Promise.resolve(items.map(() => [0.1, 0.2])));
    // All articles match the single keyword "Anthropic" → one group of N
    mockCosineSimilarity.mockImplementation(() => 1.0);
  });

  test("20 articles of one keyword are scored in a single LLM call", async () => {
    const { scoreAndSaveTagged } = await import("@/lib/score-pipeline");
    const { tagArticlesByKeyword } = await import("@/lib/vector-filter");
    const articles = Array.from({ length: 20 }, (_, i) => makeArticle(`https://example.com/${i}`));
    const tagged = await tagArticlesByKeyword(articles, ["Anthropic"]);
    const saved = await scoreAndSaveTagged(tagged);
    expect(saved).toBe(20);
    expect(mockScoreArticles).toHaveBeenCalledTimes(1);
    expect(mockScoreArticles.mock.calls[0][0]).toHaveLength(20);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(20);
  });

  test("25 articles of one keyword split into 20 + 5 (2 LLM calls)", async () => {
    const { scoreAndSaveTagged } = await import("@/lib/score-pipeline");
    const { tagArticlesByKeyword } = await import("@/lib/vector-filter");
    const articles = Array.from({ length: 25 }, (_, i) => makeArticle(`https://example.com/${i}`));
    const tagged = await tagArticlesByKeyword(articles, ["Anthropic"]);
    const saved = await scoreAndSaveTagged(tagged);
    expect(saved).toBe(25);
    expect(mockScoreArticles).toHaveBeenCalledTimes(2);
    expect(mockScoreArticles.mock.calls[0][0]).toHaveLength(20);
    expect(mockScoreArticles.mock.calls[1][0]).toHaveLength(5);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(25);
  });
});
