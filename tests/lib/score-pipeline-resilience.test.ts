import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import * as llmMod from "@/lib/llm";

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn(),
  buildPreferencePromptSection: vi.fn(() => ""),
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: vi.fn(),
  getLatestPreferenceProfile: vi.fn().mockResolvedValue(null),
}));

describe("score-pipeline-resilience", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(llmMod.buildPreferencePromptSection).mockReturnValue("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(upsertArticles).not.toHaveBeenCalled();
  });

  test("leaves articles unscored when the pipeline deadline expires before their batch", async () => {
    const articles = [
      {
        title: "Test",
        description: "Desc",
        url: "https://example.com/deadline",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Source",
        sourceId: "src",
        author: "Author",
      },
    ];
    let clockReads = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (clockReads++ === 0 ? 0 : 60_000));
    const { upsertArticles } = await import("@/lib/db");
    const onScoringError = vi.fn();

    await scoreAndSaveTagged(articles, { onScoringError });

    expect(llmMod.scoreArticles).not.toHaveBeenCalled();
    expect(upsertArticles).not.toHaveBeenCalled();
    expect(onScoringError).toHaveBeenCalledWith("Scoring deadline exceeded");
  });

  test("preserves successful LLM scoring when article persistence fails", async () => {
    vi.mocked(llmMod.scoreArticles).mockResolvedValueOnce([{} as never]);
    const { upsertArticles } = await import("@/lib/db");
    vi.mocked(upsertArticles).mockRejectedValueOnce(new Error("database unavailable"));
    const onScoringSuccess = vi.fn();
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

    const result = await scoreAndSaveTagged(articles, { onScoringSuccess, onScoringError });

    expect(result).toBe(0);
    expect(onScoringSuccess).toHaveBeenCalledOnce();
    expect(onScoringError).toHaveBeenCalledWith("database unavailable");
  });

  test("scores consecutive batches in sequence", async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => ({
      title: `Article ${index}`,
      description: "Description",
      url: `https://example.com/${index}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Source",
      sourceId: "src",
      author: "Author",
    }));
    const articles = [
      ...firstBatch,
      { ...firstBatch[0], title: "Article 20", url: "https://example.com/20" },
    ];

    let resolveFirstBatch!: (results: never[]) => void;
    const firstBatchResult = new Promise<never[]>((resolve) => {
      resolveFirstBatch = resolve;
    });
    const scoreArticles = vi.mocked(llmMod.scoreArticles);
    scoreArticles.mockReturnValueOnce(firstBatchResult);
    scoreArticles.mockResolvedValueOnce([{} as never]);

    const { upsertArticles } = await import("@/lib/db");
    vi.mocked(upsertArticles).mockImplementation(async (rows) => ({
      succeeded: rows.map((row) => row.url),
      failed: [],
    }));

    const scoring = scoreAndSaveTagged(articles, { preferenceSection: "" });
    await vi.waitFor(() => expect(scoreArticles).toHaveBeenCalledOnce());
    expect(scoreArticles.mock.calls[0][0]).toHaveLength(20);

    resolveFirstBatch(Array.from({ length: 20 }, () => ({}) as never));
    const savedCount = await scoring;

    expect(scoreArticles).toHaveBeenCalledTimes(2);
    expect(scoreArticles.mock.calls[1][0]).toHaveLength(1);
    expect(savedCount).toBe(21);
  });
});
