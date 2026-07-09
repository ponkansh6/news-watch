import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as fetchPost } from "@/app/api/fetch-news/route";
import { POST as scorePost } from "@/app/api/score-articles/route";
import { POST as statusPost } from "@/app/api/scoring-status/route";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as gemini from "@/lib/llm/gemini";

/**
 * Realistic e2e test for the production scoring flow INCLUDING the UI's polling
 * against /api/scoring-status.
 *
 * Flow: fetch-news (production QStash path) -> score-articles (simulated QStash
 * delivery) saves tagged articles to a real in-memory DB -> scoring-status is
 * polled the same way the UI does.
 *
 * Root-cause reproduction: fetch-news reports `keyword: "latest"`, but
 * score-articles tags/saves each article under one of the configured KEYWORDS.
 * The UI derives its polling keywords from fetch-news's response
 * (`data.results.map(r => r.keyword)` => ["latest"]), so scoring-status never
 * finds the scored articles and polling never completes.
 */

// Isolate the DB to an in-memory instance for this test (ignores TURSO_* env).
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  return { db };
});

// Mock the Google GenerativeAI SDK to return valid embeddings (no network, no
// rate-limit rejection) so scoring actually completes and articles get saved.
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        embedContent: vi.fn(async () => ({
          embedding: { values: [0.1, 0.2, 0.3, 0.4] },
        })),
      };
    }
  },
  TaskType: {
    RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
    RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
  },
}));

// Mock QStash: capture the published message, and make the Receiver verify.
const h = vi.hoisted(() => ({
  state: { capturedBody: null as any, verifyResult: true },
}));

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
  // Return one scored result per input article (matches the real Gemini call,
  // which scores the whole batch). The previous single-result mock caused
  // scoreAndSaveTagged to save only 1 of 4 batched articles.
  scoreArticles: vi.fn(async (batch: any[]) =>
    (batch ?? []).map(() => ({
      relevance: 8,
      usefulness: 7,
      summary: "Test summary",
      reason: "Test reason",
    })),
  ),
  scoreArticle: vi.fn().mockResolvedValue({
    relevance: 8,
    usefulness: 7,
    summary: "Test summary",
    reason: "Test reason",
  }),
}));

let mockKeywords = ["Anthropic", "OpenAI", "Softbank", "KDDI", "NTT"];
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return mockKeywords;
  },
}));

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

function gnewsArticles() {
  return makeArticles("gnews", 3);
}
function newsapiArticles() {
  return makeArticles("newsapi", 3);
}
function hackernewsArticles() {
  return makeArticles("hackernews", 3).map((a) => ({ ...a, story_text: a.description }));
}
function qiitaArticles() {
  return makeArticles("qiita", 3).map((a) => ({
    ...a,
    body: a.description,
    created_at: a.publishedAt,
    user: { name: "u" },
  }));
}
function githubArticles() {
  return makeArticles("github", 3).map((a) => ({
    name: a.title,
    html_url: a.url,
    description: a.description,
    created_at: a.publishedAt,
    owner: { login: "u" },
  }));
}
function yamadashyArticles() {
  return makeArticles("yamadashy", 3).map((a) => ({
    title: a.title,
    link: a.url,
    description: a.description,
    pubDate: a.publishedAt,
    author: "a",
  }));
}
function itmediaArticles() {
  return makeArticles("itmedia", 3).map((a) => ({
    title: a.title,
    link: a.url,
    description: a.description,
    pubDate: a.publishedAt,
  }));
}
function codezineArticles() {
  return makeArticles("codezine", 3).map((a) => ({
    title: a.title,
    link: a.url,
    description: a.description,
    pubDate: a.publishedAt,
  }));
}

vi.mock("@/lib/news/gnews", () => ({
  searchGNews: vi.fn().mockResolvedValue(gnewsArticles()),
}));
vi.mock("@/lib/news/newsapi", () => ({
  searchNewsApi: vi.fn().mockResolvedValue(newsapiArticles()),
}));
vi.mock("@/lib/news/hackernews", () => ({
  searchHackerNews: vi.fn().mockResolvedValue(hackernewsArticles()),
}));
vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockResolvedValue(qiitaArticles()),
}));
vi.mock("@/lib/news/github", () => ({
  searchGitHub: vi.fn().mockResolvedValue(githubArticles()),
}));
vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi.fn().mockResolvedValue(yamadashyArticles()),
}));
vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi.fn().mockResolvedValue(itmediaArticles()),
}));
vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi.fn().mockResolvedValue(codezineArticles()),
}));

const ALL_SOURCES = [
  "gnews",
  "newsapi",
  "hackernews",
  "qiita",
  "github",
  "yamadashy",
  "itmedia",
  "codezine",
];
const originalEnv = process.env;

describe("e2e production flow with polling", () => {
  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      QSTASH_TOKEN: "test-token",
      NODE_ENV: "production",
      GOOGLE_API_KEY: "test-key",
    };
    h.state.capturedBody = null;
    vi.clearAllMocks();
    await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
    await db.delete(articles);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("UI polling detects scoring completion (reproduces the production bug when it fails)", async () => {
    // 1. fetch-news (production QStash path)
    const fetchReq = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ALL_SOURCES }),
      headers: { "Content-Type": "application/json" },
    });
    const fetchRes = await fetchPost(fetchReq);
    const fetchData = await fetchRes.json();
    expect(fetchRes.status).toBe(200);
    expect(Array.isArray(fetchData.results)).toBe(true);

    const totalFetched = fetchData.results.reduce(
      (acc: number, r: any) => acc + (r.fetched || 0),
      0,
    );
    expect(totalFetched).toBeGreaterThan(0);

    // The UI sets `since` right after fetch-news returns, i.e. BEFORE the
    // (async QStash) scoring runs, so scoredAt is always >= since.
    const since = new Date().toISOString();

    // 2. Simulate QStash delivery of the queued articles
    expect(h.state.capturedBody).not.toBeNull();
    const scoreReq = new NextRequest("http://localhost/api/score-articles", {
      method: "POST",
      body: JSON.stringify({ articles: h.state.capturedBody.articles }),
      headers: { "Content-Type": "application/json", "upstash-signature": "sig" },
    });
    const scoreRes = await scorePost(scoreReq);
    const scoreData = await scoreRes.json();
    expect(scoreRes.status).toBe(200);
    expect(scoreData.saved).toBe(totalFetched);

    // 3. UI polling: articles are saved under the configured KEYWORDS, so the
    // fixed UI polls those (mirrors the patched fetch-button.tsx).
    const pollingKeywords = mockKeywords;
    const statusReq = new Request("http://localhost/api/scoring-status", {
      method: "POST",
      body: JSON.stringify({ keywords: pollingKeywords, since }),
      headers: { "Content-Type": "application/json" },
    });
    const statusRes = await statusPost(statusReq);
    const statusData = await statusRes.json();
    expect(statusRes.status).toBe(200);

    const totalScored = (statusData.status as any[]).reduce((acc, s) => acc + (s.scored || 0), 0);

    // All articles are tagged/saved under the configured KEYWORDS, so polling
    // those keywords reports the full count and the UI detects completion.
    expect(totalScored).toBe(totalFetched);
  });
});
