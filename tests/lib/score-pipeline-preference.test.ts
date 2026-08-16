import { describe, expect, test, vi, beforeEach } from "vitest";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import * as dbMod from "@/lib/db";
import * as llmMod from "@/lib/llm";
import type { NormalizedArticle } from "@/lib/types";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return {
    ...actual,
    getLatestPreferenceProfile: vi.fn(),
    upsertArticles: vi.fn().mockImplementation((list: any[]) =>
      Promise.resolve({
        succeeded: list.map((item) => item.url),
        failed: [],
      }),
    ),
  };
});

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return {
    ...actual,
    scoreArticles: vi.fn().mockResolvedValue([
      { summary: "Test summary", usefulness: 8, ntt_relevance: 9, reason: "Good" },
      { summary: "Test summary", usefulness: 8, ntt_relevance: 9, reason: "Good" },
    ]),
    buildPreferencePromptSection: vi.fn().mockImplementation((analysis) => {
      return analysis ? "section:" + JSON.stringify(analysis) : "";
    }),
  };
});

describe("scoreAndSaveTagged with preference profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleArticles: NormalizedArticle[] = [
    {
      title: "日本語記事 1",
      description: "Desc 1",
      url: "https://example.com/1",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
    },
    {
      title: "日本語記事 2",
      description: "Desc 2",
      url: "https://example.com/2",
      urlToImage: null,
      publishedAt: "2026-01-01T00:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: null,
    },
  ];

  test("Test 1: no profile -> default empty section", async () => {
    vi.mocked(dbMod.getLatestPreferenceProfile).mockResolvedValueOnce(null);

    const count = await scoreAndSaveTagged(sampleArticles);
    expect(count).toBe(2);

    expect(dbMod.getLatestPreferenceProfile).toHaveBeenCalledTimes(1);
    expect(llmMod.buildPreferencePromptSection).toHaveBeenCalledWith(null);

    const scoreArticlesMock = vi.mocked(llmMod.scoreArticles);
    expect(scoreArticlesMock).toHaveBeenCalled();
    for (const call of scoreArticlesMock.mock.calls) {
      expect(call[1]).toBe("");
    }
  });

  test("Test 2: profile present -> all batches receive the same section", async () => {
    const mockProfile = {
      id: 1,
      version: 1,
      analysis: {
        themes: ["TypeScript"],
        traits: [],
        dislikes: [],
        scoringGuidance: [],
        summary: "Test",
      },
      promptSection: 'section:{"themes":["TypeScript"]}',
      favoriteCount: 5,
      favoriteMaxId: 10,
      notForMeCount: 0,
      notForMeMaxId: 0,
      model: "test-model",
      createdAt: "2026-01-01T00:00:00Z",
    };
    vi.mocked(dbMod.getLatestPreferenceProfile).mockResolvedValueOnce(mockProfile);

    const count = await scoreAndSaveTagged(sampleArticles);
    expect(count).toBe(2);

    expect(dbMod.getLatestPreferenceProfile).toHaveBeenCalledTimes(1);
    expect(llmMod.buildPreferencePromptSection).toHaveBeenCalledWith(mockProfile.analysis);

    const scoreArticlesMock = vi.mocked(llmMod.scoreArticles);
    expect(scoreArticlesMock).toHaveBeenCalled();
    for (const call of scoreArticlesMock.mock.calls) {
      expect(call[1]).toBe("section:" + JSON.stringify(mockProfile.analysis));
    }
  });

  test("Test 3: DB throws -> continues with empty section", async () => {
    vi.mocked(dbMod.getLatestPreferenceProfile).mockRejectedValueOnce(
      new Error("DB connection failed"),
    );
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const count = await scoreAndSaveTagged(sampleArticles);
    expect(count).toBe(2);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[pipeline] Failed to load preference profile"),
      expect.any(Error),
    );

    const scoreArticlesMock = vi.mocked(llmMod.scoreArticles);
    expect(scoreArticlesMock).toHaveBeenCalled();
    for (const call of scoreArticlesMock.mock.calls) {
      expect(call[1]).toBe("");
    }

    consoleSpy.mockRestore();
  });

  test("Test 4: explicit options.preferenceSection wins (getLatestPreferenceProfile NOT called)", async () => {
    const count = await scoreAndSaveTagged(sampleArticles, {
      preferenceSection: "custom-section",
    });
    expect(count).toBe(2);

    expect(dbMod.getLatestPreferenceProfile).not.toHaveBeenCalled();

    const scoreArticlesMock = vi.mocked(llmMod.scoreArticles);
    expect(scoreArticlesMock).toHaveBeenCalled();
    for (const call of scoreArticlesMock.mock.calls) {
      expect(call[1]).toBe("custom-section");
    }
  });
});
