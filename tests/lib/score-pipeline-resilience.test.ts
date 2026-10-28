import { describe, expect, test, vi, beforeEach } from "vitest";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import * as llmMod from "@/lib/llm";

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: vi.fn(),
}));

describe("score-pipeline-resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("scoreArticles failure does not throw in scoreAndSaveTagged and returns 0", async () => {
    vi.mocked(llmMod.scoreArticles).mockRejectedValueOnce(new Error("LLM failure"));

    const articles = [
      {
        title: "Test",
        description: "Desc",
        url: "https://example.com/1",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Source",
        sourceId: "src",
        author: "Author",
      },
    ];

    const onScoringError = vi.fn();
    const result = await scoreAndSaveTagged(articles, { onScoringError });
    expect(result).toBe(0);
    expect(onScoringError).toHaveBeenCalledWith("LLM failure");
  });

  test("reports an article whose LLM result is null", async () => {
    vi.mocked(llmMod.scoreArticles).mockResolvedValueOnce([null]);
    const { upsertArticles } = await import("@/lib/db");
    vi.mocked(upsertArticles).mockResolvedValueOnce({ succeeded: [], failed: [] } as never);
    const onScoringError = vi.fn();
    const articles = [
      {
        title: "Test",
        description: "Desc",
        url: "https://example.com/1",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Source",
        sourceId: "src",
        author: "Author",
      },
    ];

    await scoreAndSaveTagged(articles, { onScoringError });

    expect(onScoringError).toHaveBeenCalledWith("LLM returned no scoring result for an article");
  });
});
