import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";

vi.mock("@/lib/news/zenn", () => ({
  searchZenn: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn().mockImplementation((articles: any[]) =>
    Promise.resolve(
      articles.map(() => ({
        ntt_relevance: 8,
        usefulness: 7,
        summary: "Test summary",
        reason: "Test reason",
      })),
    ),
  ),
  scoreArticle: vi.fn().mockResolvedValue({
    ntt_relevance: 8,
    usefulness: 7,
    summary: "Test summary",
    reason: "Test reason",
  }),
  buildPreferencePromptSection: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: vi.fn().mockImplementation((dataList: any[]) =>
    Promise.resolve({
      succeeded: dataList.map((d) => d.url),
      failed: [],
    }),
  ),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
  refreshRecencyForSources: vi.fn().mockResolvedValue(0),
  getLatestPreferenceProfile: vi.fn().mockResolvedValue(null),
  getScoringStateByUrls: vi.fn().mockResolvedValue(new Map()),
  deleteStaleLowScored: vi.fn().mockResolvedValue(undefined),
}));

describe("fetch cap (MAX_ARTICLES = 40)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("should cap total fetched articles at 40 even if source returns more", async () => {
    const zenn = await import("@/lib/news/zenn");
    // Return 60 articles
    const manyArticles = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      title: `Zenn Article ${i + 1}`,
      slug: `zenn-article-${i + 1}`,
      liked_count: 5,
      bookmarked_count: 2,
      article_type: "tech",
      emoji: "📝",
      published_at: new Date().toISOString(),
      path: `/articles/zenn-article-${i + 1}`,
      user: { username: "user1", name: "User One" },
    }));
    vi.mocked(zenn.searchZenn).mockResolvedValue(manyArticles);

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    // fetched count should be 60, scored 40, deferred 20
    expect(data.results[0].fetched).toBe(60);
    expect(data.results[0].scored).toBe(40);
    expect(data.results[0].deferred).toBe(20);
    expect(data.results[0].skipped).toBe(0);
  });
});
