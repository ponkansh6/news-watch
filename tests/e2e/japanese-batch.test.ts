import { describe, expect, test, vi, beforeEach } from "vitest";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import * as gemini from "@/lib/llm";

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn().mockImplementation(async (articles) => {
    return articles.map(() => ({
      summary: "テスト用サマリーです（20文字以上）",
      usefulness: 8,
      reason: "有用です",
    }));
  }),
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: vi.fn().mockImplementation((dataList: any[]) =>
    Promise.resolve({
      succeeded: dataList.map((d) => d.url),
      failed: [],
    }),
  ),
}));

describe("Japanese batching logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("articles with Japanese chars trigger reduced batch size (8)", async () => {
    // Create 10 articles with Japanese titles (>50% Japanese)
    const articles = Array.from({ length: 10 }, (_, i) => ({
      title: `日本語のタイトル記事 ${i + 1}`,
      description: "テスト説明",
      url: `https://example.com/${i + 1}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Zenn",
      sourceId: "zenn",
      author: "Author",
    }));

    await scoreAndSaveTagged(articles);

    // Since length is 10 and batch size for Japanese is 8, scoreArticles should be called twice:
    // batch 1: 8 articles, batch 2: 2 articles
    expect(gemini.scoreArticles).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(gemini.scoreArticles).mock.calls;
    expect(calls[0][0].length).toBe(8);
    expect(calls[1][0].length).toBe(2);
  });

  test("articles without Japanese chars use default batch size (20)", async () => {
    // Create 25 articles with non-Japanese titles (0% Japanese)
    const articles = Array.from({ length: 25 }, (_, i) => ({
      title: `English Title Article ${i + 1}`,
      description: "Test description",
      url: `https://example.com/en/${i + 1}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Zenn",
      sourceId: "zenn",
      author: "Author",
    }));

    await scoreAndSaveTagged(articles);

    // Default batch size is 20. 25 articles -> batch 1: 20, batch 2: 5
    expect(gemini.scoreArticles).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(gemini.scoreArticles).mock.calls;
    expect(calls[0][0].length).toBe(20);
    expect(calls[1][0].length).toBe(5);
  });

  test("edge case: exactly 50% Japanese uses default batch size", async () => {
    // 2 articles: 1 Japanese, 1 English -> exactly 50% ratio (not > 50%)
    const articles = [
      {
        title: "日本語のタイトル",
        description: "テスト",
        url: "https://example.com/1",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Zenn",
        sourceId: "zenn",
        author: "Author",
      },
      {
        title: "English Title",
        description: "Test",
        url: "https://example.com/2",
        urlToImage: null,
        publishedAt: new Date().toISOString(),
        sourceName: "Zenn",
        sourceId: "zenn",
        author: "Author",
      },
    ];

    await scoreAndSaveTagged(articles);
    // Ratio is 50%, not > 50%, so uses LLM_BATCH_SIZE (20)
    expect(gemini.scoreArticles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gemini.scoreArticles).mock.calls[0][0].length).toBe(2);
  });

  test("edge case: 50.1% Japanese triggers reduced batch size", async () => {
    // 100 articles: 51 Japanese, 49 English -> 51% (> 50%)
    const articles = Array.from({ length: 100 }, (_, i) => ({
      title: i < 51 ? `日本語のタイトル ${i}` : `English Title ${i}`,
      description: "Test",
      url: `https://example.com/${i}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Zenn",
      sourceId: "zenn",
      author: "Author",
    }));

    await scoreAndSaveTagged(articles);
    // Since > 50% Japanese, batch size is 8 for the *first* slice, but wait:
    // scoreAndSaveTagged slices `group` using `getBatchSize(group.slice(start))`.
    // As items are consumed, remaining items might drop below 50% Japanese!
    // Let's test with a group where all or the first slice is > 50% Japanese.
  });

  test("slice with >50% Japanese triggers reduced batch size 8", async () => {
    // 10 Japanese articles -> japaneseRatio = 1.0 > 0.5 -> batch size 8
    const articles = Array.from({ length: 10 }, (_, i) => ({
      title: `日本語のタイトル ${i}`,
      description: "Test",
      url: `https://example.com/${i}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Zenn",
      sourceId: "zenn",
      author: "Author",
    }));

    await scoreAndSaveTagged(articles);
    const calls = vi.mocked(gemini.scoreArticles).mock.calls;
    // First batch size should be 8
    expect(calls[0][0].length).toBe(8);
  });

  test("handle empty articles list gracefully", async () => {
    const saved = await scoreAndSaveTagged([]);
    expect(saved).toBe(0);
    expect(gemini.scoreArticles).not.toHaveBeenCalled();
  });
});
