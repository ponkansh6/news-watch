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

vi.mock("@/lib/config", () => ({
  KEYWORDS: ["Anthropic"],
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

  // ---------- Happy path ----------

  test("returns 200 and scores all articles with valid request", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [makeArticle(), makeArticle({ title: "Article 2" })];
    const request = makeRequest({ articles }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.saved).toBe(2);
    expect(data.total).toBe(2);
    expect(data.message).toBe("Successfully scored and saved articles");

    // LLM scoring called with correct args
    expect(mockScoreArticles).toHaveBeenCalledWith(
      articles.map((a) => ({ title: a.title, description: a.description })),
      "Anthropic", // keyword is "Anthropic" for tagged articles
    );
    // upsertArticle called for each article
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    expect(mockUpsertArticle).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Test Article", keyword: "Anthropic" }),
    );
  });

  test("includes composite score, recency, and LLM fields in upsert", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const article = makeArticle({
      publishedAt: new Date().toISOString(), // < 1 day → recency = 10
    });
    const request = makeRequest({ articles: [article] }, "valid-sig");

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
    const request = makeRequest({ articles }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(0);
    expect(data.total).toBe(2);

    // upsertArticle still called for every article.
    expect(mockUpsertArticle).toHaveBeenCalledTimes(2);
    expect(mockUpsertArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        relevance: null,
        usefulness: null,
        score: null,
        scoredAt: expect.any(String),
      }),
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
    const request = makeRequest({ articles }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(2);
    expect(data.total).toBe(3);
    expect(mockUpsertArticle).toHaveBeenCalledTimes(3);
  });

  test("handles empty articles array", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const request = makeRequest({ articles: [] }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(0);
    expect(data.total).toBe(0);
    expect(mockScoreArticles).not.toHaveBeenCalled();
    expect(mockUpsertArticle).not.toHaveBeenCalled();
  });

  test("scores articles in batches of LLM_BATCH_SIZE (20)", async () => {
    const { POST } = await import("@/app/api/score-articles/route");
    const articles = [
      makeArticle({ url: "https://example.com/a1" }),
      makeArticle({ url: "https://example.com/a2" }),
      makeArticle({ url: "https://example.com/a3" }),
      makeArticle({ url: "https://example.com/a4" }),
      makeArticle({ url: "https://example.com/a5" }),
      makeArticle({ url: "https://example.com/a6" }),
      makeArticle({ url: "https://example.com/a7" }),
      makeArticle({ url: "https://example.com/a8" }),
      makeArticle({ url: "https://example.com/a9" }),
      makeArticle({ url: "https://example.com/a10" }),
      makeArticle({ url: "https://example.com/a11" }),
      makeArticle({ url: "https://example.com/a12" }),
      makeArticle({ url: "https://example.com/a13" }),
      makeArticle({ url: "https://example.com/a14" }),
      makeArticle({ url: "https://example.com/a15" }),
      makeArticle({ url: "https://example.com/a16" }),
      makeArticle({ url: "https://example.com/a17" }),
      makeArticle({ url: "https://example.com/a18" }),
      makeArticle({ url: "https://example.com/a19" }),
      makeArticle({ url: "https://example.com/a20" }),
      makeArticle({ url: "https://example.com/a21" }),
      makeArticle({ url: "https://example.com/a22" }),
      makeArticle({ url: "https://example.com/a23" }),
      makeArticle({ url: "https://example.com/a24" }),
      makeArticle({ url: "https://example.com/a25" }),
    ];
    const request = makeRequest({ articles }, "valid-sig");
    const response = await POST(request);
    expect(response.status).toBe(200);
    // 25 articles, single keyword "Anthropic" → 2 batches (20 + 5)
    expect(mockScoreArticles).toHaveBeenCalledTimes(2);
    expect(mockScoreArticles.mock.calls[0][0]).toHaveLength(20);
    expect(mockScoreArticles.mock.calls[1][0]).toHaveLength(5);
    for (const call of mockScoreArticles.mock.calls) {
      expect(call[1]).toBe("Anthropic");
    }
    expect(mockUpsertArticle).toHaveBeenCalledTimes(25);
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
    const request = makeRequest({ articles }, "valid-sig");

    const response = await POST(request);
    expect(response.status).toBe(200);

    const calls = mockUpsertArticle.mock.calls;
    expect(calls[0][0].recency).toBe(10); // 1 hour → recency=10
    expect(calls[1][0].recency).toBe(8); // 2 days → recency=8
    expect(calls[2][0].recency).toBe(6); // 7 days → recency=6
    expect(calls[3][0].recency).toBe(0); // 31 days → recency=0

    vi.useRealTimers();
  });
});
