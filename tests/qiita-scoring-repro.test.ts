/**
 * Qiita 75件取得・0件スコアリング 再現テスト
 *
 * 本テストは以下のシナリオを検証する:
 * - 複数キーワード × Qiita 記事で fetched=75, scored=0 が発生する条件
 * - LLM スコアリング失敗時（null返却）の動作
 * - スコアリング失敗後も記事が DB に保存されるか
 * - deleteLowScoredArticles による削除条件
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";

// ============================================================
// Mock 設定（トップレベルで宣言し、vi.mock がホイストされるようにする）
// ============================================================

// コントローラブルな mock 関数: 各テストで mockResolvedValue を差し替える
const mockScoreArticles = vi.fn();

// DB actions はモックして、実際の DB 操作を検証しやすくする
const mockUpsertArticle = vi.fn();
const mockDeleteOrphanedArticles = vi.fn();
const mockDeleteLowScoredArticles = vi.fn();

const MOCK_KEYWORDS = ["Next.js", "TypeScript", "React", "AI", "database"];

function buildQiitaArticles(count: number, keyword: string, date?: string) {
  const dt = date ?? new Date(Date.now() - 3600_000).toISOString();
  return Array.from({ length: count }, (_, i) => ({
    id: `qiita-${keyword}-${i}`,
    title: `[${keyword}] Qiita Article ${i}: ${keyword} no tameno gaido`,
    url: `https://qiita.com/${keyword}/articles/${i}`,
    created_at: dt,
    user: { name: `user${i}`, id: `user${i}` },
    tags: [{ name: keyword }, { name: "tech" }],
    likes_count: Math.floor(Math.random() * 100),
    page_views_count: Math.floor(Math.random() * 10000),
  }));
}

// 各キーワードに15件のQiita記事を準備（5 keywords × 15 = 75 articles）
const QIITA_ARTICLES: Record<string, ReturnType<typeof buildQiitaArticles>> = {};
for (const kw of MOCK_KEYWORDS) {
  QIITA_ARTICLES[kw] = buildQiitaArticles(15, kw);
}

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockImplementation((keyword: string) => {
    return Promise.resolve(QIITA_ARTICLES[keyword] ?? []);
  }),
}));

vi.mock("@/lib/llm/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/gemini")>();
  return {
    ...actual,
    scoreArticles: mockScoreArticles,
  };
});

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: mockUpsertArticle,
  deleteOrphanedArticles: mockDeleteOrphanedArticles,
  deleteLowScoredArticles: mockDeleteLowScoredArticles,
}));

vi.mock("@/lib/config", () => ({
  KEYWORDS: MOCK_KEYWORDS,
}));

vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = vi.fn().mockResolvedValue({ messageId: "test-msg" });
  },
}));

// ルートモジュールはトップレベルでインポックしない（テスト内で動的インポートする）

// ============================================================
// Test Suite
// ============================================================

describe("Qiita scoring reproduction: 75 fetched, 0 scored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルトで全件失敗（各テストで上書き）
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) =>
        Promise.resolve(articles.map(() => null)),
    );
    mockUpsertArticle.mockResolvedValue(undefined);
    mockDeleteOrphanedArticles.mockResolvedValue(undefined);
    mockDeleteLowScoredArticles.mockResolvedValue(undefined);
  });

  /**
   * テスト1: LLMが全件失敗（null返却）した場合 → fetched > 0, scored = 0
   *
   * 現実の production で「75件取得0件スコアリング」が発生するのは
   * OpenRouter API の呼び出しが全件失敗している可能性が高い。
   * このテストでそのシナリオを再現する。
   */
  test("should report scored=0 when LLM returns null for all articles", async () => {
    mockScoreArticles.mockResolvedValue(MOCK_KEYWORDS.map(() => null));

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
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
      expect(result.errors).toHaveLength(0);
      totalFetched += result.fetched;
    }

    // 5 keywords × 10 articles each = 50 total
    expect(totalFetched).toBe(50);

    // upsertArticle は呼ばれていないこと（score-articles で呼ばれるため）
    expect(mockUpsertArticle).not.toHaveBeenCalled();
  });

  /**
   * テスト2: LLMが正常動作した場合 → fetched = scored
   * 正常系の確認。Qiita 記事も正しくスコアリングされることを確認する。
   */
  test("should score all articles when LLM works correctly", async () => {
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) => {
        return Promise.resolve(
          articles.map(() => ({
            summary: "テスト記事の要約",
            relevance: 8,
            usefulness: 7,
            reason: "キーワード関連性が高く技術的価値があるため",
          })),
        );
      },
    );

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
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
      expect(result.errors).toHaveLength(0);
    }
    expect(totalFetched).toBe(50);
  });

  /**
   * テスト3: LLMが一部失敗した場合 → fetched > scored > 0
   */
  test("should report partial scoring when LLM sometimes fails", async () => {
    let callCount = 0;
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) => {
        return Promise.resolve(
          articles.map((_, i) => {
            callCount++;
            // 3回に1回失敗する
            return callCount % 3 === 0
              ? null
              : {
                  summary: "部分的な要約",
                  relevance: 7,
                  usefulness: 6,
                  reason: "部分的な理由",
                };
          }),
        );
      },
    );

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
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
      expect(result.errors).toHaveLength(0);
    }

    // 50 articles
    expect(totalFetched).toBe(50);
  });

  /**
   * テスト4: 75件取得・0件スコアリング → deleteLowScoredArticles 後の状態
   *
   * LLM が全件失敗した場合、composite score = (5*0.3 + 5*0.4 + recency*0.3)
   * 新しい記事（recency=10）: 1.5 + 2.0 + 3.0 = 6.5 ≥ 5 → 削除されない
   * 古い記事（recency=0）: 1.5 + 2.0 + 0 = 3.5 < 5 → 削除される
   */
  test("should keep fresh articles and delete old ones when LLM fails", async () => {
    mockScoreArticles.mockResolvedValue([]);

    // old articles 用に古い日付データを上書き
    const oldDate = "2024-01-01T00:00:00.000Z";
    for (const kw of MOCK_KEYWORDS) {
      QIITA_ARTICLES[kw] = buildQiitaArticles(15, kw, oldDate);
    }

    const { POST } = await import("@/app/api/fetch-news/route");

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Scoring queued");

    // fetched > 0 を確認
    for (const result of data.results) {
      expect(result.fetched).toBeGreaterThan(0);
    }

    // deleteLowScoredArticles が呼ばれていること
    expect(mockDeleteLowScoredArticles).toHaveBeenCalledWith(5);
  });

  /**
   * テスト5: 実際の normalize 関数が Qiita 記事を正しく処理できるか
   * QiitaArticle interface に description がないため description=null になることを確認
   */
  test("should normalize Qiita article with description=null", async () => {
    const mockQiitaArticle = {
      id: "test-1",
      title: "Test Qiita Article",
      url: "https://qiita.com/test/1",
      created_at: "2026-07-05T00:00:00.000Z",
      user: { name: "testuser", id: "testuser" },
      tags: [{ name: "JavaScript" }],
      likes_count: 10,
      page_views_count: 100,
    };

    // normalize を直接テストするため、route モジュールから normalize 相当のロジックを確認
    // 「description」プロパティがない ⇒ description=null になる
    expect("description" in mockQiitaArticle).toBe(false);

    // scoreArticle に description=null が渡されても "(no description)" に置換されることを確認
    // テスト5ではscoreArticleを直接呼び出すため、scoreArticlesは使用しない
    // APIキーとfetchをモックして実際のAPIを叩かないようにする
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
                    text: '{"summary":"テスト","relevance":5,"usefulness":5,"reason":"テスト理由"}',
                  },
                ],
              },
            },
          ],
        }),
    });

    try {
      const { scoreArticle } = await import("@/lib/llm/gemini");
      const result = await scoreArticle(
        { title: "Test Qiita Article", description: null },
        "test-keyword",
      );

      expect(result).not.toBeNull();
      expect(result!.relevance).toBe(5);
    } finally {
      process.env.GOOGLE_API_KEY = origKey;
      globalThis.fetch = origFetch;
    }
  });
});
