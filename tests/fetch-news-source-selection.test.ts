import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";

// Mock all external dependencies
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
      id: "1",
      title: "Qiita Article",
      link: "https://qiita.com/1",
      published: new Date().toISOString(),
      updated: new Date().toISOString(),
      author: { name: "user1" },
      content: "desc",
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
  scoreArticles: vi
    .fn()
    .mockImplementation((articles: { title: string; description: string | null }[]) =>
      Promise.resolve(
        articles.map(() => ({
          relevance: 8,
          usefulness: 7,
          summary: "Test summary",
          reason: "Test reason",
        })),
      ),
    ),
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 8,
    usefulness: 7,
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

vi.mock("@/lib/config", () => ({
  KEYWORDS: ["test-keyword"],
}));

// Mock embeddings so the local dev scoring path does not
// depend on network access to the Google API.
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  batchEmbed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  cosineSimilarity: vi.fn().mockReturnValue(1.0),
}));

vi.mock("@/lib/vector-math", () => ({
  cosineSimilarity: vi.fn().mockReturnValue(1.0),
}));

describe("fetch-news route source selection", () => {
  test("should work when qiita is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when yamadashy is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "yamadashy" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should default to zenn when no source provided", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when zenn is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should return 400 when invalid source is provided", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "not-a-real-source" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("invalid source");
  });
});
