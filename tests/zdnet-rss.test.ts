import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import * as db from "@/lib/db";

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

vi.mock("@/lib/news/qiita", () => ({ searchQiita: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/yamadashy", () => ({ searchYamadashy: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/zenn", () => ({ searchZenn: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/itmedia", () => ({ searchITmedia: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/news/codezine", () => ({ searchCodeZine: vi.fn().mockResolvedValue([]) }));

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
}));

describe("ZDNet RSS統合テスト", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("ZDNet記事が正しく処理される", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zdnet" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    const upsertCalls = vi.mocked(db.upsertArticles).mock.calls;
    const allArticles = upsertCalls.flatMap((call) => call[0]);
    expect(allArticles.length).toBe(2);
  });
});
