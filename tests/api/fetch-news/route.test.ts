import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/fetch-news/route";
import * as gemini from "@/lib/llm";
import * as db from "@/lib/db";

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

vi.mock("@/lib/llm", () => ({
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

  test("CRON_SECRET auth guard - missing or invalid authorization header returns 401", async () => {
    vi.stubEnv("CRON_SECRET", "my-secret");
    try {
      // 1. Missing header
      let req = new NextRequest("http://localhost/api/fetch-news", { method: "POST" });
      let res = await POST(req);
      expect(res.status).toBe(401);

      // 2. Invalid header format
      req = new NextRequest("http://localhost/api/fetch-news", {
        method: "POST",
        headers: { authorization: "Basic wrong" },
      });
      res = await POST(req);
      expect(res.status).toBe(401);

      // 3. Incorrect token
      req = new NextRequest("http://localhost/api/fetch-news", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
      });
      res = await POST(req);
      expect(res.status).toBe(401);

      // 4. Correct token
      req = new NextRequest("http://localhost/api/fetch-news", {
        method: "POST",
        headers: { authorization: "Bearer my-secret" },
        body: JSON.stringify({ source: "zenn" }),
      });
      res = await POST(req);
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("Validation error - invalid source name returns 400 Bad Request", async () => {
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "non-existent-source" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe("invalid source");
  });

  test("Deduplicate with unparseable URLs triggers catch branch", async () => {
    const qiitaMod = await import("@/lib/news/qiita");
    vi.mocked(qiitaMod.searchQiita).mockResolvedValueOnce([
      {
        id: "1",
        title: "Bad URL Article 1",
        link: "not-a-valid-url",
        published: new Date().toISOString(),
        updated: new Date().toISOString(),
        content: "content",
        author: { name: "Author 1" },
      } as any,
      {
        id: "2",
        title: "Bad URL Article 2",
        link: "not-a-valid-url", // duplicate raw string to test seen.has(a.url)
        published: new Date().toISOString(),
        updated: new Date().toISOString(),
        content: "content",
        author: { name: "Author 2" },
      } as any,
    ]);

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // Should deduplicate the second bad URL item and have fetched 1 unique item
    expect(data.results[0].fetched).toBe(1);
  });

  test("Zero fetched articles skips scoring block (else branch)", async () => {
    const zennMod = await import("@/lib/news/zenn");
    vi.mocked(zennMod.searchZenn).mockResolvedValueOnce([]);

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].fetched).toBe(0);
    expect(data.results[0].saved).toBeUndefined();
  });

  test("normalize helper function fallback", async () => {
    const { normalize } = await import("@/app/api/fetch-news/route");
    const article = normalize({ title: "Unknown", url: "https://example.com" }, "unknown-source");
    expect(article).toBeDefined();
    expect(article.title).toBe("Unknown");
  });
});
