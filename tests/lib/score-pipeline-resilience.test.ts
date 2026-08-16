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

    const result = await scoreAndSaveTagged(articles);
    expect(result).toBe(0);
  });
});
