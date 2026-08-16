/**
 * E2E test: LLM batch consolidation.
 *
 * Verifies that with LLM_BATCH_SIZE = 20, articles are scored
 * in batches of up to 20 instead of being split into small batches.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { mockScoreArticles } = vi.hoisted(() => ({ mockScoreArticles: vi.fn() }));
const { mockUpsertArticle } = vi.hoisted(() => ({ mockUpsertArticle: vi.fn() }));

vi.mock("@/lib/llm", () => ({
  scoreArticles: mockScoreArticles,
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: mockUpsertArticle,
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

describe("e2e: batch consolidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) =>
        Promise.resolve(
          articles.map(() => ({
            summary: "s",
            usefulness: 7,
            ntt_relevance: 8,
            topic: "Anthropic",
            reason: "r",
          })),
        ),
    );
    mockUpsertArticle.mockImplementation((dataList: any[]) => {
      return Promise.resolve({
        succeeded: dataList.map((d) => d.url),
        failed: [],
      });
    });
  });

  test("20 articles are scored in a single LLM call", async () => {
    const { scoreAndSaveTagged } = await import("@/lib/score-pipeline");
    const articles = Array.from({ length: 20 }, (_, i) => makeArticle(`https://example.com/${i}`));
    const saved = await scoreAndSaveTagged(articles);
    expect(saved).toBe(20);
    expect(mockScoreArticles).toHaveBeenCalledTimes(1);
    expect(mockScoreArticles.mock.calls[0][0]).toHaveLength(20);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(1);
    expect(mockUpsertArticle.mock.calls[0][0]).toHaveLength(20);
  });

  test("25 articles split into 20 + 5 (2 LLM calls)", async () => {
    const { scoreAndSaveTagged } = await import("@/lib/score-pipeline");
    const articles = Array.from({ length: 25 }, (_, i) => makeArticle(`https://example.com/${i}`));
    const saved = await scoreAndSaveTagged(articles);
    expect(saved).toBe(25);
    expect(mockScoreArticles).toHaveBeenCalledTimes(2);
    expect(mockScoreArticles.mock.calls[0][0]).toHaveLength(20);
    expect(mockScoreArticles.mock.calls[1][0]).toHaveLength(5);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    expect(mockUpsertArticle.mock.calls[0][0]).toHaveLength(20);
    expect(mockUpsertArticle.mock.calls[1][0]).toHaveLength(5);
  });
});
