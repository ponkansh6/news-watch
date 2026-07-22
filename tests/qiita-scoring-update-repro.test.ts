/**
 * Qiita Atomフィード記事のスコアリング更新バグ再現テスト
 *
 * バグ: normalize関数の型絞り込み順序が間違っており、
 * Qiita記事（Atomフィード）がYamadashy記事として誤分類される。
 * これによりURLがオブジェクトのままになり、upsertArticleで正しく更新されない。
 *
 * このテストは修正後の正常な動作を検証する。
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/fetch-news/route";
import { upsertArticle } from "@/lib/db/actions";

// ============================================================
// Mock 設定（vi.mockはホイストされるため、データをファクトリ内で定義）
// ============================================================

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

// 他のソースは空配列を返す
vi.mock("@/lib/news/newsapi", () => ({
  searchNewsApi: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi.fn().mockResolvedValue([]),
}));

// LLMスコアリングは正常に動作するモック
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      relevance: 8,
      usefulness: 7,
      summary: "Test summary",
      reason: "Test reason",
    },
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

// DB操作のモック - vi.mock内で直接定義してホイスト問題を回避
vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
}));

let mockKeywords = ["TypeScript", "React"];
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return mockKeywords;
  },
}));

// 埋め込みモック
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  batchEmbed: vi.fn().mockResolvedValue([
    [0.1, 0.2],
    [0.1, 0.2],
  ]),
  cosineSimilarity: vi.fn().mockReturnValue(0.9),
}));

// ============================================================
// Test Suite
// ============================================================

describe("Qiita Atomフィード記事のスコアリング更新 - 修正後の正常動作検証", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("修正後: Qiita記事が正しく分類され、URLが文字列として抽出される", async () => {
    mockKeywords = ["TypeScript", "React"];

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["qiita"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    // upsertArticleが呼ばれた引数を検証
    expect(upsertArticle).toHaveBeenCalled();

    const upsertCalls = vi.mocked(upsertArticle).mock.calls;
    console.log("Upsert calls:", JSON.stringify(upsertCalls, null, 2));

    // 修正後: Qiita記事が2件あり、URLが正しく文字列として抽出されている
    // 正常: url = "https://qiita.com/user1/items/abc123" (string)
    const qiitaUrls = upsertCalls
      .map((call) => call[0].url)
      .filter((url) => typeof url === "string" && url.includes("qiita.com"));

    console.log("Qiita URLs found:", qiitaUrls);

    // 修正後はこのアサーションが通る
    expect(qiitaUrls.length).toBe(2);
    expect(qiitaUrls.every((url) => url.startsWith("https://qiita.com/"))).toBe(true);

    // sourceNameが "Qiita" になっていること
    const qiitaSourceNames = upsertCalls
      .map((call) => call[0].sourceName)
      .filter((name) => name === "Qiita");
    expect(qiitaSourceNames.length).toBe(2);

    // sourceIdが "qiita" になっていること
    const qiitaSourceIds = upsertCalls
      .map((call) => call[0].sourceId)
      .filter((id) => id === "qiita");
    expect(qiitaSourceIds.length).toBe(2);
  });

  test("正常系: Yamadashy記事は正しく分類される", async () => {
    mockKeywords = ["Tech"];

    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ["yamadashy"] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    const upsertCalls = vi.mocked(upsertArticle).mock.calls;
    const yamadashyUrls = upsertCalls
      .map((call) => call[0].url)
      .filter((url) => url.includes("techblog.com"));

    expect(yamadashyUrls.length).toBeGreaterThan(0);
    expect(yamadashyUrls.every((url) => url.startsWith("https://techblog.com/"))).toBe(true);

    const yamadashySourceNames = upsertCalls
      .map((call) => call[0].sourceName)
      .filter((name) => name === "Tech Blog");
    expect(yamadashySourceNames.length).toBeGreaterThan(0);
  });
});
