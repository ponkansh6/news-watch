import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import { upsertArticle } from "@/lib/db/actions";

// Mock 設定
vi.mock("@/lib/news/hatena", () => ({
  searchHatena: vi.fn().mockResolvedValue([
    {
      title: "Hatena記事1",
      link: "https://example-user1.hatenablog.com/entry/1",
      description: "desc1",
      pubDate: "2026-07-14T08:00:00Z",
      author: "user1",
    },
    {
      title: "Hatena記事2",
      link: "https://example-user2.hatenablog.com/entry/2",
      description: "desc2",
      pubDate: "2026-07-14T09:00:00Z",
      author: "user2",
    },
  ]),
}));

// 他のソースは空配列を返す
vi.mock("@/lib/news/qiita", () => ({ searchQiita: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/yamadashy", () => ({ searchYamadashy: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/newsapi", () => ({ searchNewsApi: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/itmedia", () => ({ searchITmedia: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/codezine", () => ({ searchCodeZine: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/zdnet", () => ({ searchZdnet: vi.fn().mockResolvedValue([]) }));

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

describe("Hatena RSS統合テスト", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("Hatena記事が正しく処理される", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["hatena"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    const upsertCalls = vi.mocked(upsertArticle).mock.calls;

    // Hatena記事が2件あるはず
    const hatenaArticles = upsertCalls
      .map((call) => call[0])
      .filter((article) => article.sourceId === "hatena");

    expect(hatenaArticles.length).toBe(2);
    expect(hatenaArticles[0].sourceName).toBe("Hatena Blog");
    expect(hatenaArticles[0].url).toBe("https://example-user1.hatenablog.com/entry/1");
    expect(hatenaArticles[0].author).toBe("user1");
    expect(hatenaArticles[0].publishedAt).toBe("2026-07-14T08:00:00Z");
  });
});
