/**
 * score-articles route (QStash Receiver) tests.
 *
 * Covers:
 * - Signature verification (missing / invalid / valid)
 * - Request body validation (missing articles, keyword, etc.)
 * - LLM scoring integration
 * - Partial and full scoring scenarios
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ============================================================
// Controllable mocks (hoisted for vi.mock factory access)
// ============================================================

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));
const { mockScoreArticles } = vi.hoisted(() => ({ mockScoreArticles: vi.fn() }));
const { mockUpsertArticle } = vi.hoisted(() => ({ mockUpsertArticle: vi.fn() }));
const { mockEmbedArticle } = vi.hoisted(() => ({ mockEmbedArticle: vi.fn() }));
const { mockEmbedQuery } = vi.hoisted(() => ({ mockEmbedQuery: vi.fn() }));
const { mockCosineSimilarity } = vi.hoisted(() => ({ mockCosineSimilarity: vi.fn() }));

// ============================================================
// Module mocks
// ============================================================

vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    verify = mockVerify;
  } as any,
}));

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: mockScoreArticles,
}));

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: mockUpsertArticle,
}));

vi.mock("@/lib/embeddings", () => ({
  embedArticle: mockEmbedArticle,
  embedQuery: mockEmbedQuery,
  cosineSimilarity: mockCosineSimilarity,
}));

// ============================================================
// Test helpers
// ============================================================

function makeArticle(
  overrides: Partial<{
    title: string;
    description: string | null;
    url: string;
    urlToImage: string | null;
    publishedAt: string;
    sourceName: string | null;
    sourceId: string;
    author: string | null;
  }> = {},
) {
  return {
    title: "Test Article",
    description: "Test description",
    url: "https://example.com/article",
    urlToImage: "https://example.com/image.jpg",
    publishedAt: new Date().toISOString(),
    sourceName: "Test Source",
    sourceId: "test-source",
    author: "Test Author",
    ...overrides,
  };
}

function makeRequest(body: unknown, signature?: string): NextRequest {
  return new NextRequest("http://localhost/api/score-articles", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(signature !== undefined ? { "upstash-signature": signature } : {}),
    },
  });
}

const LLM_OK = { summary: "Good", relevance: 8, usefulness: 7, reason: "Relevant" };

// ============================================================
// Tests
// ============================================================

describe("score-articles endpoint (QStash Receiver)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: signature verification succeeds
    mockVerify.mockResolvedValue(undefined);
    // Default: LLM scores successfully
    mockScoreArticles.mockImplementation(
      (articles: { title: string; description: string | null }[]) =>
        Promise.resolve(articles.map(() => ({ ...LLM_OK }))),
    );
    // Default: upsert succeeds
    mockUpsertArticle.mockResolvedValue(undefined);
    // Default: embedding succeeds
    mockEmbedArticle.mockResolvedValue([0.1, 0.2]);
    // Default: embedQuery succeeds
    mockEmbedQuery.mockResolvedValue([0.1, 0.2]);
    // Default: cosine similarity returns 1.0 (all articles pass the threshold)
    mockCosineSimilarity.mockImplementation(() => 1.0);
  });

  // ---------- Signature verification ----------

  test("returns 401 when upstash-signature header is missing", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: [], keyword: "test" }, undefined);
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Missing signature");
  });

  test("returns 401 when signature is invalid (verify throws)", async () => {
    mockVerify.mockRejectedValue(new Error("Invalid signature"));

    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: [], keyword: "test" }, "bad-sig");
    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid signature");
  });

  // ---------- Request body validation ----------

  test("returns 400 when request body has no articles", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ keyword: "test" }, "valid-sig");
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid request body");
  });

  test("returns 400 when articles is not an array", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: "not-array", keyword: "test" }, "valid-sig");
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid request body");
  });

  test("returns 400 when keyword is missing", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: [makeArticle()] }, "valid-sig");
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid request body");
  });

  // ---------- Happy path ----------

  test("returns 200 and scores all articles with valid request", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [makeArticle(), makeArticle({ title: "Article 2" })];
    const request = makeRequest({ articles, keyword: "test-keyword" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.saved).toBe(2);
    expect(data.total).toBe(2);
    expect(data.message).toContain("test-keyword");

    // LLM scoring called with correct args
    expect(mockScoreArticles).toHaveBeenCalledWith(
      articles.map((a) => ({ title: a.title, description: a.description })),
      "test-keyword",
    );
    // upsertArticle called for each article
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    expect(mockUpsertArticle).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Test Article", keyword: "test-keyword" }),
    );
  });

  test("includes composite score, recency, and LLM fields in upsert", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const article = makeArticle({
      publishedAt: new Date().toISOString(), // < 1 day → recency = 10
    });
    const request = makeRequest({ articles: [article], keyword: "kw" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);

    // relevance=8, usefulness=7, recency=10
    // composite = (8 * 0.3) + (7 * 0.4) + (10 * 0.3) = 2.4 + 2.8 + 3.0 = 8.2
    expect(mockUpsertArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        relevance: 8,
        usefulness: 7,
        recency: 10,
        score: 8.2,
        summary: "Good",
        reason: "Relevant",
        scoredAt: expect.any(String),
      }),
    );
  });

  // ---------- Edge cases ----------

  test("saves articles even when LLM returns null for all (saved=0)", async () => {
    mockScoreArticles.mockResolvedValue([null, null]);

    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [makeArticle(), makeArticle({ title: "Article 2" })];
    const request = makeRequest({ articles, keyword: "test" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(0);
    expect(data.total).toBe(2);

    // upsertArticle still called for every article.
    // Articles pass the similarity threshold (default cosine = 1.0) but LLM
    // returned null, so relevance falls back to 0 (not null) per route logic.
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    expect(mockUpsertArticle).toHaveBeenCalledWith(
      expect.objectContaining({ relevance: 0, usefulness: null, score: null, scoredAt: null }),
    );
  });

  test("handles partial LLM results", async () => {
    mockScoreArticles.mockResolvedValue([{ ...LLM_OK }, null, { ...LLM_OK, relevance: 6 }]);

    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [
      makeArticle({ url: "https://example.com/a1" }),
      makeArticle({ title: "Article 2", url: "https://example.com/a2" }),
      makeArticle({ title: "Article 3", url: "https://example.com/a3" }),
    ];
    const request = makeRequest({ articles, keyword: "test" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(2);
    expect(data.total).toBe(3);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(3);
  });

  test("handles empty articles array", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: [], keyword: "test" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(0);
    expect(data.total).toBe(0);
    expect(mockScoreArticles).toHaveBeenCalledWith([], "test");
    expect(mockUpsertArticle).not.toHaveBeenCalled();
  });

  test("similarity filter works: only articles above threshold are LLM-scored", async () => {
    // Mock cosineSimilarity to control similarity values (mockCosineSimilarity is hoisted)
    // Setup: keyword embedding = [1, 0], article1 = [1, 0] (sim 1.0), article2 = [0, 1] (sim 0.0)
    mockCosineSimilarity.mockImplementation((a: number[], b: number[]) => {
      // Simple dot product for testing
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      const normA = Math.sqrt(a.reduce((sum: number, v: number) => sum + v * v, 0));
      const normB = Math.sqrt(b.reduce((sum: number, v: number) => sum + v * v, 0));
      return dot / (normA * normB);
    });
    
    // Mock embedQuery to return keyword embedding [1, 0]
    mockEmbedQuery.mockResolvedValue([1, 0]);
    // Mock embedArticle to return different vectors for different articles
    mockEmbedArticle.mockImplementation(async (title) => {
      if (title === "Article 1") return [1, 0]; // identical to keyword
      if (title === "Article 2") return [0, 1]; // orthogonal to keyword
      return [0.1, 0.2];
    });
    
    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [
      makeArticle({ title: "Article 1", url: "https://example.com/a1" }),
      makeArticle({ title: "Article 2", url: "https://example.com/a2" }),
    ];
    const request = makeRequest({ articles, keyword: "test-keyword" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Only Article 1 should be scored (similarity 1.0 >= 0.75)
    expect(data.saved).toBe(1);
    expect(data.total).toBe(2);
    
    // Verify mockScoreArticles was called only once with Article 1
    expect(mockScoreArticles).toHaveBeenCalledTimes(1);
    expect(mockScoreArticles).toHaveBeenCalledWith(
      [{ title: "Article 1", description: "Test description" }],
      "test-keyword",
    );
    
    // Verify upsertArticle was called twice (both articles)
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    
    // Verify Article 1 was LLM-scored (passed the similarity threshold)
    const calls = mockUpsertArticle.mock.calls;
    const article1Call = calls.find(call => call[0].title === "Article 1");
    const article2Call = calls.find(call => call[0].title === "Article 2");

    expect(article1Call).toBeDefined();
    expect(article1Call![0].relevance).toBe(8); // LLM_OK.relevance (scored article)
    expect(article1Call![0].scoredAt).toBeDefined(); // has scoredAt

    expect(article2Call).toBeDefined();
    expect(article2Call![0].relevance).toBe(null); // filtered out article
    expect(article2Call![0].scoredAt).toBe(null); // no scoredAt
  });

  test("calculates recency based on article publishedAt", async () => {
    // Freeze time to avoid Date.now() drift between article creation and route execution
    vi.useFakeTimers();
    const FROZEN_NOW = 1780000000000; // deterministic timestamp
    vi.setSystemTime(FROZEN_NOW);

    const { POST } = await import("@/app/api/score-articles/route");

    const oneHourAgo = new Date(FROZEN_NOW - 3600_000).toISOString();
    const twoDaysAgo = new Date(FROZEN_NOW - 2 * 86400_000).toISOString();
    const oneWeekAgo = new Date(FROZEN_NOW - 7 * 86400_000).toISOString();
    const oneMonthAgo = new Date(FROZEN_NOW - 31 * 86400_000).toISOString();

    const articles = [
      makeArticle({ publishedAt: oneHourAgo }), // days <= 1  → recency = 10
      makeArticle({ publishedAt: twoDaysAgo }), // days <= 3  → recency = 8
      makeArticle({ publishedAt: oneWeekAgo }), // days <= 7  → recency = 6
      makeArticle({ publishedAt: oneMonthAgo }), // days > 30  → recency = 0
    ];
    const request = makeRequest({ articles, keyword: "test" }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);

    const calls = mockUpsertArticle.mock.calls;
    expect(calls[0][0].recency).toBe(10); // 1 hour → recency=10
    expect(calls[1][0].recency).toBe(8); // 2 days → recency=8
    expect(calls[2][0].recency).toBe(6); // 7 days → recency=6
    expect(calls[3][0].recency).toBe(0); // 31 days → recency=0

    vi.useRealTimers();
  });

  test("dryRun returns filter stats without calling LLM or DB", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [
      makeArticle({ title: "Article 1", url: "https://example.com/a1" }),
      makeArticle({ title: "Article 2", url: "https://example.com/a2" }),
    ];
    // dryRun: true, threshold override 0.5
    const request = makeRequest(
      { articles, keyword: "test-keyword", threshold: 0.5, dryRun: true },
      "valid-sig",
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.dryRun).toBe(true);
    expect(data.threshold).toBe(0.5);
    expect(data.total).toBe(2);
    expect(data.passed).toBe(2); // cosine mock = 1.0 >= 0.5
    expect(data.filtered).toBe(0);

    // LLM and DB must NOT be touched in dry-run mode
    expect(mockScoreArticles).not.toHaveBeenCalled();
    expect(mockUpsertArticle).not.toHaveBeenCalled();
  });
});
