import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/fetch-news/route";
import * as gemini from "@/lib/llm/gemini";
import * as db from "@/lib/db/actions";

// Mock news source modules
vi.mock("@/lib/news/zenn", () => ({
  searchZenn: vi.fn().mockResolvedValue([
    {
      title: "Zenn Article",
      path: "/articles/zenn-1",
      published_at: new Date().toISOString(),
      user: { name: "Zenn User" },
    },
  ]),
}));

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockResolvedValue([
    {
      title: "Qiita Article",
      link: "https://qiita.com/items/1",
      published: new Date().toISOString(),
      author: { name: "Qiita User" },
    },
  ]),
}));

vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/zdnet", () => ({
  searchZdnet: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/xtech", () => ({
  searchXtech: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/hatena", () => ({
  searchHatena: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/hatena-discovery", () => ({
  discoverHatenaFeeds: vi.fn().mockResolvedValue({ discovered: 0, updated: 0, errors: [] }),
}));

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      relevance: 9,
      usefulness: 8,
      summary: "Summary of article",
      reason: "Good reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 9,
    usefulness: 8,
    summary: "Summary of article",
    reason: "Good reason",
  }),
}));

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
  refreshRecencyForSources: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/vector-filter", () => ({
  tagArticlesByKeyword: vi.fn().mockImplementation(async (articles) => {
    return articles.map((a: any) => ({ ...a, keyword: "test-keyword" }));
  }),
}));

vi.mock("@/lib/score-pipeline", () => ({
  scoreAndSaveTagged: vi.fn().mockResolvedValue(1),
}));

let mockKeywords = ["test-keyword"];
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return mockKeywords;
  },
}));

vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  batchEmbed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  cosineSimilarity: vi.fn().mockReturnValue(1.0),
}));

describe("POST /api/fetch-news", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("GET request returns instructions message", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBeDefined();
  });

  test("POST request triggers the pipeline and returns 200 with status info", async () => {
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toBeDefined();
    expect(data.results[0].fetched).toBeGreaterThan(0);
  });

  test("POST request with missing body defaults to zenn", async () => {
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("POST request with selectedSources parameter filters sources", async () => {
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.perSource).toEqual([{ source: "qiita", fetched: 1 }]);
  });

  test("Error handling - when pipeline/scoring fails, returns appropriate error response", async () => {
    const scorePipeline = await import("@/lib/score-pipeline");
    vi.mocked(scorePipeline.scoreAndSaveTagged).mockRejectedValueOnce(new Error("LLM failure"));

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toContain("Scoring failed: Error: LLM failure");
  });
});
