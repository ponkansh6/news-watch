import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as fetchPost } from "@/app/api/fetch-news/route";
import { POST as statusPost } from "@/app/api/scoring-status/route";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as gemini from "@/lib/llm/gemini";

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

vi.mock("@/lib/llm/gemini", () => ({
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

describe("e2e local-dev flow with polling (inline scoring)", () => {
  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      GOOGLE_API_KEY: "test-key",
    };
    vi.clearAllMocks();
    await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
    await db.delete(articles);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("local-dev inline scoring: UI polling completes (processed === fetched)", async () => {
    vi.mocked(gemini.scoreArticles).mockImplementation(async (batch: any[]) =>
      (batch ?? []).map(() => ({
        relevance: 8,
        usefulness: 7,
        summary: "Test summary",
        reason: "Test reason",
      })),
    );

    const fetchReq = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ALL_SOURCES }),
      headers: { "Content-Type": "application/json" },
    });
    const fetchRes = await fetchPost(fetchReq);
    const fetchData = await fetchRes.json();
    expect(fetchRes.status).toBe(200);

    const totalFetched = fetchData.results.reduce(
      (acc: number, r: any) => acc + (r.fetched || 0),
      0,
    );
    expect(totalFetched).toBeGreaterThan(0);

    const since = (fetchData.since as string) || new Date().toISOString();

    const statusReq = new Request("http://localhost/api/scoring-status", {
      method: "POST",
      body: JSON.stringify({ keywords: mockKeywords, since }),
      headers: { "Content-Type": "application/json" },
    });
    const statusRes = await statusPost(statusReq);
    const statusData = await statusRes.json();
    expect(statusRes.status).toBe(200);

    const totalProcessed = (statusData.status as any[]).reduce(
      (acc, s) => acc + (s.processed || 0),
      0,
    );
    const totalScored = (statusData.status as any[]).reduce((acc, s) => acc + (s.scored || 0), 0);

    expect(totalProcessed).toBe(totalFetched);
    expect(totalScored).toBe(totalFetched);
  });

  test("local-dev inline scoring completes even when some articles fail LLM scoring", async () => {
    vi.mocked(gemini.scoreArticles).mockImplementation(async (batch: any[]) =>
      (batch ?? []).map((_, i) =>
        i % 2 === 0
          ? { relevance: 8, usefulness: 7, summary: "Test summary", reason: "Test reason" }
          : null,
      ),
    );

    const fetchReq = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ sources: ALL_SOURCES }),
      headers: { "Content-Type": "application/json" },
    });
    const fetchRes = await fetchPost(fetchReq);
    const fetchData = await fetchRes.json();
    expect(fetchRes.status).toBe(200);

    const totalFetched = fetchData.results.reduce(
      (acc: number, r: any) => acc + (r.fetched || 0),
      0,
    );
    expect(totalFetched).toBeGreaterThan(0);

    const since = (fetchData.since as string) || new Date().toISOString();

    const statusReq = new Request("http://localhost/api/scoring-status", {
      method: "POST",
      body: JSON.stringify({ keywords: mockKeywords, since }),
      headers: { "Content-Type": "application/json" },
    });
    const statusRes = await statusPost(statusReq);
    const statusData = await statusRes.json();
    expect(statusRes.status).toBe(200);

    const totalScored = (statusData.status as any[]).reduce((acc, s) => acc + (s.scored || 0), 0);
    const totalProcessed = (statusData.status as any[]).reduce(
      (acc, s) => acc + (s.processed || 0),
      0,
    );

    expect(totalScored).toBeLessThan(totalFetched);
    expect(totalProcessed).toBe(totalFetched);
  });
});
