/**
 * Qiita Atomフィード記事のスコアリング更新バグ再現テスト
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import * as db from "@/lib/db";

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockResolvedValue([
    {
      id: "qiita-1",
      title: "TypeScriptで型安全なAPIクライアントを作る",
      link: { "@_href": "https://qiita.com/user1/items/abc123" },
      published: "2026-07-10T10:00:00.000Z",
      updated: "2026-07-10T10:00:00.000Z",
      author: { name: "user1" },
      content: "TypeScriptで型安全なAPIクライアントを作る方法について解説します...",
    },
    {
      id: "qiita-2",
      title: "React Server Componentsの基礎",
      link: { "@_href": "https://qiita.com/user2/items/def456" },
      published: "2026-07-11T10:00:00.000Z",
      updated: "2026-07-11T10:00:00.000Z",
      author: { name: "user2" },
      content: "React Server Componentsの基本的な使い方とメリット...",
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

vi.mock("@/lib/news/zenn", () => ({
  searchZenn: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      ntt_relevance: 8,
      usefulness: 7,
      summary: "Test summary",
      reason: "Test reason",
    },
    {
      ntt_relevance: 8,
      usefulness: 7,
      summary: "Test summary",
      reason: "Test reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    ntt_relevance: 8,
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
  refreshRecencyForSources: vi.fn().mockResolvedValue(undefined),
  getLatestPreferenceProfile: vi.fn().mockResolvedValue(null),
}));

describe("Qiita Atomフィード記事のスコアリング更新 - 修正後の正常動作検証", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GOOGLE_API_KEY: "test-api-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("Qiita Atomフィード記事が正しく取得され、LLMスコアリングされてupsertされる", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    const qiitaResult = data.perSource.find((r: any) => r.source === "qiita");
    expect(qiitaResult).toBeDefined();
    expect(qiitaResult.fetched).toBe(2);
    expect(data.results[0].errors).toHaveLength(0);

    // upsertArticles が正しい記事データ（URLが文字列）で呼び出されていること
    const upsertMock = vi.mocked(db.upsertArticles);
    expect(upsertMock).toHaveBeenCalled();
    const calledDataList = upsertMock.mock.calls[0][0];
    expect(calledDataList).toHaveLength(2);
    for (const item of calledDataList) {
      expect(typeof item.url).toBe("string");
      expect(item.url).not.toBeInstanceOf(Object);
      expect(item.sourceId).toBe("qiita");
      expect(item.sourceName).toBe("Qiita");
    }
  });
});
