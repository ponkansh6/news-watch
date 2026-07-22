import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import { upsertArticle } from "@/lib/db/actions";

// Mock 設定
vi.mock("@/lib/news/zdnet", () => ({
  searchZdnet: vi.fn().mockResolvedValue([
    {
      title: "ZDNet記事1",
      link: "https://japan.zdnet.com/article/789/",
      description: "desc1",
      date: "2026-07-14T08:00:00Z",
      creator: "佐藤花子",
    },
    {
      title: "ZDNet記事2",
      link: "https://japan.zdnet.com/article/790/",
      description: "desc2",
      date: "2026-07-14T09:00:00Z",
      creator: "佐藤花子",
    },
  ]),
}));

// 他のソースは空配列を返す
vi.mock("@/lib/news/qiita", () => ({ searchQiita: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/yamadashy", () => ({ searchYamadashy: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/newsapi", () => ({ searchNewsApi: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/itmedia", () => ({ searchITmedia: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/codezine", () => ({ searchCodeZine: vi.fn().mockResolvedValue([]) }));

// LLMスコアリングは正常に動作するモック
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    { relevance: 8, usefulness: 7, summary: "Test summary", reason: "Test reason" },
    { relevance: 8, usefulness: 7, summary: "Test summary", reason: "Test reason" },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 8,
    usefulness: 7,
    summary: "Test summary",
    reason: "Test reason",
  }),
}));

// DB操作のモック
vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return ["TypeScript"];
  },
}));

vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  batchEmbed: vi.fn().mockResolvedValue([
    [0.1, 0.2],
    [0.1, 0.2],
  ]),
  cosineSimilarity: vi.fn().mockReturnValue(0.9),
}));

describe("ZDNet RSS統合テスト", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("ZDNet記事が正しく処理される", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["zdnet"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    const upsertCalls = vi.mocked(upsertArticle).mock.calls;

    // ZDNet記事が2件あるはず
    const zdnetArticles = upsertCalls
      .map((call) => call[0])
      .filter((article) => article.sourceId === "zdnet");

    expect(zdnetArticles.length).toBe(2);
    expect(zdnetArticles[0].sourceName).toBe("ZDNet Japan");
    expect(zdnetArticles[0].url).toBe("https://japan.zdnet.com/article/789/");
    expect(zdnetArticles[0].author).toBe("佐藤花子");
    expect(zdnetArticles[0].publishedAt).toBe("2026-07-14T08:00:00Z");
  });
});
