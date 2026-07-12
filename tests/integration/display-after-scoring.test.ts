import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// --- Mock the DB with an isolated in-memory client + schema -------------
// Mirrors tests/db/actions.test.ts: the app's `db` module points at a
// fresh :memory: client so the test never touches Turso, and we create the
// `articles` table explicitly.
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

import * as dbMod from "@/lib/db";
import { getScoredArticles } from "@/lib/db/actions";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import type { NormalizedArticle } from "@/lib/types";
import ArticleList from "@/app/article-list";
import { renderToStaticMarkup } from "react-dom/server";

// --- Mock embeddings so tagArticlesByKeyword needs no real API ----------
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn(async () => new Array(768).fill(0.1)),
  embedQuery: vi.fn(async () => new Array(768).fill(0.1)),
  cosineSimilarity: vi.fn(() => 0.9),
}));

// --- Mock LLM scoring so scoreAndSaveTagged needs no real API ----------
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    });
  },
}));

beforeEach(() => {
  process.env.GOOGLE_API_KEY = "test-key";
  mockGenerateContent.mockResolvedValue({
    response: {
      text: () =>
        JSON.stringify(
          Array.from({ length: ARTICLE_COUNT }).map((_, i) => ({
            summary: `要約: ${i}`,
            relevance: 7 + (i % 3),
            usefulness: 6 + (i % 4),
            reason: `関連`,
          })),
        ),
    },
  });
});

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    url_to_image TEXT,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_id TEXT,
    author TEXT,
    keyword TEXT NOT NULL,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

const ARTICLE_COUNT = 20;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

afterEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

describe("Display after scoring (scored articles appear in the view)", () => {
  it("shows every fetched+scored article in the scored-articles list once scoring completes", async () => {
    // Before scoring, the scored-articles view is empty.
    expect(await getScoredArticles()).toHaveLength(0);

    // 1) Simulate fetched articles (the "取得記事").
    const fetched: NormalizedArticle[] = Array.from({ length: ARTICLE_COUNT }).map((_, i) => ({
      title: `取得記事 ${i}: ${KEYWORDS[i % KEYWORDS.length]} に関する解説`,
      description: `これは記事 ${i} の説明です。AI と半導体について扱っています。`,
      url: `http://test.com/display/${i}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Test Source",
      sourceId: "test-source",
      author: "Test Author",
    }));

    // 2) Run the exact inline pipeline fetch-news uses: tag -> score -> save.
    const tagged = await tagArticlesByKeyword(fetched, KEYWORDS);
    const savedCount = await scoreAndSaveTagged(tagged);

    // 3) The page reads scored articles via getScoredArticles — the same call
    //    page.tsx makes to populate the "スコアリング済み記事" section.
    const scored = await getScoredArticles(100);

    // 4) Assert the data feeding the view contains every fetched article.
    expect(savedCount).toBe(ARTICLE_COUNT);
    expect(scored).toHaveLength(ARTICLE_COUNT);
    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.summary).not.toBeNull();
      expect(a.relevance).not.toBeNull();
      expect(a.usefulness).not.toBeNull();
    }

    // 5) Assert the view actually renders them. ArticleList is the component
    //    page.tsx passes the scored articles to, so this verifies the
    //    "scored articles are displayed" contract end-to-end (data -> UI).
    const html = renderToStaticMarkup(ArticleList({ articles: scored }));
    for (const a of fetched) {
      expect(html).toContain(a.title);
    }
    // Each ScoreBadge renders the numeric composite score.
    for (const a of scored) {
      expect(html).toContain(String(a.score));
    }
  }, 30000);
});
