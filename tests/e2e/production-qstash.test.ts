import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as fetchPost } from "@/app/api/fetch-news/route";
import { POST as scorePost } from "@/app/api/score-articles/route";
import * as gemini from "@/lib/llm/gemini";
import * as db from "@/lib/db/actions";

/**
 * E2E reproduction for the production bug: "scoring does not complete in production".
 *
 * In production the flow is: fetch-news -> QStash -> score-articles. The
 * score-articles route calls `tagArticlesByKeyword`, which fires one embedding
 * request per keyword (5) and one per article (up to 20) — all concurrently via
 * Promise.all. Google's embedding API rate-limits concurrent requests (429), and
 * the embedding layer had no retry/backoff, so a single 429 aborts the whole
 * scoring run. QStash retries 3x, all fail, and scoring never completes.
 *
 * This test mocks the Google GenerativeAI SDK to reject when more than
 * EMBED_CONCURRENCY concurrent `embedContent` calls are in flight (simulating the
 * production rate limit). It exercises the REAL embeddings module, so the
 * concurrency-limiting fix in embeddings.ts is what makes it pass.
 */

const h = vi.hoisted(() => ({
  // Google's effective concurrent embedding limit.
  EMBED_CONCURRENCY: 5,
  state: {
    inFlight: 0,
    maxObserved: 0,
    limit: 5,
    capturedBody: null as any,
    verifyResult: true,
  },
}));

// Mock the Google GenerativeAI SDK to simulate production rate limiting.
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        embedContent: vi.fn(async () => {
          h.state.inFlight++;
          h.state.maxObserved = Math.max(h.state.maxObserved, h.state.inFlight);
          if (h.state.inFlight > h.state.limit) {
            h.state.inFlight--;
            throw new Error("429 Too Many Requests: embedding rate limit exceeded");
          }
          // small latency so concurrency is observable
          await new Promise((r) => setTimeout(r, 5));
          h.state.inFlight--;
          return { embedding: { values: [0.1, 0.2, 0.3, 0.4] } };
        }),
      };
    }
  },
  TaskType: {
    RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
    RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
  },
}));

// Mock QStash: capture the published message instead of hitting the network,
// and make the Receiver verify successfully (production signature check).
vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = vi.fn(async ({ body }: { body: any }) => {
      h.state.capturedBody = body;
      return { messageId: "test-message-id" };
    });
  },
  Receiver: class {
    verify = vi.fn(async () => h.state.verifyResult);
  },
}));

vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
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

vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
}));

let mockKeywords = ["ai", "security", "web", "cloud", "mobile"];
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return mockKeywords;
  },
}));

// Each source returns 3 articles so the 8 sources yield 24 -> sliced to 20.
function makeArticles(source: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `${source} Article ${i}`,
    url: `https://${source}.com/${i}`,
    description: `desc ${i}`,
    image: "img.jpg",
    source: { name: source },
    publishedAt: new Date().toISOString(),
  }));
}

vi.mock("@/lib/news/gnews", () => ({
  searchGNews: vi.fn().mockResolvedValue(makeArticles("gnews", 3)),
}));
vi.mock("@/lib/news/newsapi", () => ({
  searchNewsApi: vi.fn().mockResolvedValue(makeArticles("newsapi", 3)),
}));
vi.mock("@/lib/news/hackernews", () => ({
  searchHackerNews: vi
    .fn()
    .mockResolvedValue(
      makeArticles("hackernews", 3).map((a) => ({ ...a, story_text: a.description })),
    ),
}));
vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi
    .fn()
    .mockResolvedValue(
      makeArticles("qiita", 3).map((a) => ({
        ...a,
        body: a.description,
        created_at: a.publishedAt,
        user: { name: "u" },
      })),
    ),
}));
vi.mock("@/lib/news/github", () => ({
  searchGitHub: vi
    .fn()
    .mockResolvedValue(
      makeArticles("github", 3).map((a) => ({
        name: a.title,
        html_url: a.url,
        description: a.description,
        created_at: a.publishedAt,
        owner: { login: "u" },
      })),
    ),
}));
vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi
    .fn()
    .mockResolvedValue(
      makeArticles("yamadashy", 3).map((a) => ({
        title: a.title,
        link: a.url,
        description: a.description,
        pubDate: a.publishedAt,
        author: "a",
      })),
    ),
}));
vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi
    .fn()
    .mockResolvedValue(
      makeArticles("itmedia", 3).map((a) => ({
        title: a.title,
        link: a.url,
        description: a.description,
        pubDate: a.publishedAt,
      })),
    ),
}));
vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi
    .fn()
    .mockResolvedValue(
      makeArticles("codezine", 3).map((a) => ({
        title: a.title,
        link: a.url,
        description: a.description,
        pubDate: a.publishedAt,
      })),
    ),
}));

const originalEnv = process.env;

describe("e2e production QStash scoring path", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      QSTASH_TOKEN: "test-token",
      NODE_ENV: "production",
      GOOGLE_API_KEY: "test-key",
    };
    h.state.inFlight = 0;
    h.state.maxObserved = 0;
    h.state.capturedBody = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("fetch-news queues articles to QStash in production (does not score inline)", async () => {
    const request = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({
        sources: [
          "gnews",
          "newsapi",
          "hackernews",
          "qiita",
          "github",
          "yamadashy",
          "itmedia",
          "codezine",
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await fetchPost(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    // Production path queues to QStash and does NOT score inline.
    expect(data.results[0].saved).toBeUndefined();
    // QStash received the articles payload.
    expect(h.state.capturedBody).not.toBeNull();
    expect(Array.isArray(h.state.capturedBody.articles)).toBe(true);
    expect(h.state.capturedBody.articles.length).toBeGreaterThan(0);
  });

  test("score-articles completes scoring for queued articles under embedding rate-limit (bug reproduction)", async () => {
    // Simulate a QStash delivery of 20 articles (the production payload size).
    const articles = Array.from({ length: 20 }, (_, i) => ({
      title: `Queued Article ${i}`,
      description: `desc ${i}`,
      url: `https://queued.com/${i}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Queued",
      sourceId: "queued",
      author: null,
    }));

    const request = new NextRequest("http://localhost/api/score-articles", {
      method: "POST",
      body: JSON.stringify({ articles }),
      headers: { "Content-Type": "application/json", "upstash-signature": "sig" },
    });

    const response = await scorePost(request);
    const data = await response.json();

    // Before the fix this returns 500 (embedding 429 aborts the run) -> bug.
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.saved).toBeGreaterThan(0);
    expect(data.total).toBe(articles.length);

    // The fix must keep concurrent embedding calls within the rate limit.
    expect(h.state.maxObserved).toBeLessThanOrEqual(h.state.limit);

    // Verify the LLM scoring and DB save actually ran.
    expect(gemini.scoreArticles).toHaveBeenCalled();
    expect(db.upsertArticle).toHaveBeenCalled();
  });
});
