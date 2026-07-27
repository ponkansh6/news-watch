import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import * as gemini from "@/lib/llm/gemini";
import * as db from "@/lib/db/actions";

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

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      relevance: 8,
      usefulness: 7,
      summary: "Test summary",
      reason: "Test reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 8,
    usefulness: 7,
    summary: "Test summary",
    reason: "Test reason",
  }),
}));

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
  refreshRecencyForSources: vi.fn().mockResolvedValue(0),
}));

let mockKeywords = ["test-keyword"];
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return mockKeywords;
  },
}));

// Mock embeddings so tests do not depend on network access to the Google API.
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  batchEmbed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  cosineSimilarity: vi.fn().mockReturnValue(1.0),
}));

// ... (rest of mocks)

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
    mockKeywords = ["test-keyword"];
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0].saved).toBeGreaterThan(0);

    // Verify scoreArticles was called
    expect(gemini.scoreArticles).toHaveBeenCalled();

    // Verify upsertArticle was called
    expect(db.upsertArticle).toHaveBeenCalled();

    // Verify cleanup functions were called
    expect(db.deleteLowScoredArticles).toHaveBeenCalled();
    expect(db.deleteOrphanedArticles).toHaveBeenCalled();
  });

  test("should handle empty articles (no scoring)", async () => {
    // Mock searchZenn to return empty array
    const zenn = await import("@/lib/news/zenn");
    vi.mocked(zenn.searchZenn).mockResolvedValue([]);

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results[0].fetched).toBe(0);
    expect(gemini.scoreArticles).not.toHaveBeenCalled();
  });
});
