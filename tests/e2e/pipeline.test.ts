import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";

vi.mock("@/lib/news/zenn", () => ({
  searchZenn: vi.fn().mockResolvedValue([
    {
      id: 1,
      title: "Zenn Article",
      slug: "zenn-article",
      liked_count: 5,
      bookmarked_count: 2,
      article_type: "tech",
      emoji: "📝",
      published_at: new Date().toISOString(),
      path: "/articles/zenn-article",
      user: { username: "user1", name: "User One" },
    },
  ]),
}));

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockResolvedValue([
    {
      title: "Qiita Article",
      url: "https://qiita.com/1",
      body: "desc",
      created_at: new Date().toISOString(),
      user: { name: "user1" },
    },
  ]),
}));

vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi.fn().mockResolvedValue([
    {
      title: "Tech Blog Article",
      link: "https://techblog.com/1",
      description: "desc",
      pubDate: new Date().toISOString(),
      author: "author1",
    },
  ]),
}));

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      ntt_relevance: 8,
      usefulness: 7,
      topic: "NTT",
      summary: "Test summary",
      reason: "Test reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    ntt_relevance: 8,
    usefulness: 7,
    topic: "NTT",
    summary: "Test summary",
    reason: "Test reason",
  }),
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
}));

describe("e2e pipeline (local dev mode)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should score articles inline via local pipeline", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].fetched).toBe(1);
    expect(data.results[0].errors).toHaveLength(0);
  });
});
