/**
 * Qiita 75件取得・0件スコアリング 再現テスト
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mockScoreArticles = vi.fn();
const mockUpsertArticle = vi.fn();
const mockDeleteOrphanedArticles = vi.fn();
const mockDeleteLowScoredArticles = vi.fn();

const MOCK_TOPICS = ["Next.js", "TypeScript", "React", "AI", "database"];

function buildQiitaArticles(count: number, topic: string, date?: string) {
  const dt = date ?? new Date(Date.now() - 3600_000).toISOString();
  return Array.from({ length: count }, (_, i) => ({
    id: `qiita-${topic}-${i}`,
    title: `[${topic}] Qiita Article ${i}`,
    link: `https://qiita.com/${topic}/articles/${i}`,
    published: dt,
    updated: dt,
    author: { name: `user${i}` },
    content: `Content for ${topic} article ${i}`,
  }));
}

const QIITA_ARTICLES: Record<string, ReturnType<typeof buildQiitaArticles>> = {};
for (const kw of MOCK_TOPICS) {
  QIITA_ARTICLES[kw] = buildQiitaArticles(15, kw);
}

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi
    .fn()
    .mockImplementation(() => Promise.resolve(Object.values(QIITA_ARTICLES).flat())),
}));

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return {
    ...actual,
    scoreArticles: mockScoreArticles,
  };
});

vi.mock("@/lib/db", () => ({
  upsertArticles: mockUpsertArticle,
  deleteOrphanedArticles: mockDeleteOrphanedArticles,
  deleteLowScoredArticles: mockDeleteLowScoredArticles,
}));

describe("Qiita scoring reproduction: 75 fetched, 0 scored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) =>
        Promise.resolve(articles.map(() => null)),
    );
    mockUpsertArticle.mockImplementation((dataList: any[]) =>
      Promise.resolve({
        succeeded: dataList.map((d) => d.url),
        failed: [],
      }),
    );
    mockDeleteOrphanedArticles.mockResolvedValue(undefined);
    mockDeleteLowScoredArticles.mockResolvedValue(undefined);
  });

  test("should report scored=0 when LLM returns null for all articles", async () => {
    mockScoreArticles.mockResolvedValue(MOCK_TOPICS.map(() => null));

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Scoring queued");

    let totalFetched = 0;
    for (const result of data.results) {
      expect(result.fetched).toBeGreaterThan(0);
      totalFetched += result.fetched;
    }

    expect(totalFetched).toBeGreaterThan(0);
  });

  test("should score all articles when LLM works correctly", async () => {
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) => {
        return Promise.resolve(
          articles.map(() => ({
            summary: "テスト記事の要約",
            usefulness: 7,
            ntt_relevance: 8,
            topic: "NTT",
            reason: "キーワード関連性が高く技術的価値があるため",
          })),
        );
      },
    );

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Scoring queued");

    let totalFetched = 0;
    for (const result of data.results) {
      totalFetched += result.fetched;
      expect(result.fetched).toBeGreaterThan(0);
    }
    expect(totalFetched).toBeGreaterThan(0);
  });

  test("should report partial scoring when LLM sometimes fails", async () => {
    let callCount = 0;
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) => {
        return Promise.resolve(
          articles.map((_, i) => {
            callCount++;
            return callCount % 3 === 0
              ? null
              : {
                  summary: "部分的な要約",
                  usefulness: 6,
                  ntt_relevance: 7,
                  topic: "NTT",
                  reason: "部分的な理由",
                };
          }),
        );
      },
    );

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Scoring queued");

    let totalFetched = 0;
    for (const result of data.results) {
      totalFetched += result.fetched;
    }

    expect(totalFetched).toBeGreaterThan(0);
  });

  test("should keep fresh articles and delete old ones when LLM fails", async () => {
    mockScoreArticles.mockResolvedValue([]);

    const oldDate = "2024-01-01T00:00:00.000Z";
    for (const kw of MOCK_TOPICS) {
      QIITA_ARTICLES[kw] = buildQiitaArticles(15, kw, oldDate);
    }

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "qiita" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Scoring queued");

    for (const result of data.results) {
      expect(result.fetched).toBeGreaterThan(0);
    }

    expect(mockDeleteLowScoredArticles).toHaveBeenCalledWith(5, expect.any(String));
  });

  test("should normalize Qiita article with description=null", async () => {
    const mockQiitaArticle = {
      id: "test-1",
      title: "Test Qiita Article",
      link: "https://qiita.com/test/1",
      published: "2026-07-05T00:00:00.000Z",
      updated: "2026-07-05T00:00:00.000Z",
      author: { name: "testuser" },
      content: "Test content",
    };

    expect("description" in mockQiitaArticle).toBe(false);
    expect("content" in mockQiitaArticle).toBe(true);

    const origKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "test-key";

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"summary":"テスト","ntt_relevance":5,"usefulness":5,"topic":"NTT","reason":"テスト理由"}',
                  },
                ],
              },
            },
          ],
        }),
    });

    try {
      const { scoreArticle } = await import("@/lib/llm");
      const result = await scoreArticle({ title: "Test Qiita Article", description: null });

      expect(result).not.toBeNull();
      expect(result!.usefulness).toBe(5);
    } finally {
      process.env.GOOGLE_API_KEY = origKey;
      globalThis.fetch = origFetch;
    }
  });
});
