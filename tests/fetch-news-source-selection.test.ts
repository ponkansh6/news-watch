import { beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";

// Mock all external dependencies
vi.mock("@/lib/news/gnews", () => ({
  searchGNews: vi
    .fn()
    .mockResolvedValue([
      {
        title: "GNews Article",
        url: "https://gnews.com/1",
        description: "desc",
        image: "img.jpg",
        source: { name: "GNews" },
        publishedAt: new Date().toISOString(),
      },
    ]),
}));

vi.mock("@/lib/news/newsapi", () => ({
  searchNewsApi: vi
    .fn()
    .mockResolvedValue([
      {
        title: "NewsAPI Article",
        url: "https://newsapi.com/1",
        description: "desc",
        urlToImage: "img.jpg",
        source: { name: "NewsAPI" },
        publishedAt: new Date().toISOString(),
      },
    ]),
}));

vi.mock("@/lib/news/hackernews", () => ({
  searchHackerNews: vi
    .fn()
    .mockResolvedValue([
      {
        title: "HN Article",
        url: "https://hn.com/1",
        story_text: "desc",
        created_at: new Date().toISOString(),
        author: "user1",
      },
    ]),
}));

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi
    .fn()
    .mockResolvedValue([
      {
        title: "Qiita Article",
        url: "https://qiita.com/1",
        body: "desc",
        created_at: new Date().toISOString(),
        user: { name: "user1" },
      },
    ]),
}));

vi.mock("@/lib/news/github", () => ({
  searchGitHub: vi
    .fn()
    .mockResolvedValue([
      {
        name: "GitHub Repo",
        html_url: "https://github.com/1",
        description: "desc",
        created_at: new Date().toISOString(),
        owner: { login: "user1" },
      },
    ]),
}));

vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi
    .fn()
    .mockResolvedValue([
      {
        title: "Tech Blog Article",
        link: "https://techblog.com/1",
        description: "desc",
        pubDate: new Date().toISOString(),
        author: "author1",
      },
    ]),
}));

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 8,
    usefulness: 7,
    recency: 6,
    summary: "Test summary",
    reason: "Test reason",
  }),
}));

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/config", () => ({
  KEYWORDS: ["test-keyword"],
}));

describe("fetch-news route source selection", () => {
  test("should work when only hackernews is selected (GNews and NewsAPI unchecked)", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["hackernews"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].keyword).toBe("test-keyword");
    expect(data.results[0].fetched).toBeGreaterThan(0);
    expect(data.results[0].scored).toBeGreaterThan(0);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when only qiita is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when only github is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["github"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when only yamadashy is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["yamadashy"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when no sources selected (defaults to all)", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: [] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when only gnews is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["gnews"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });

  test("should work when only newsapi is selected", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["newsapi"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toHaveLength(0);
  });
});
