// @vitest-environment happy-dom
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { ...actual, db, __client: client };
});

import * as dbMod from "@/lib/db";
import { getScoredArticles } from "@/lib/db";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import type { NormalizedArticle } from "@/lib/types";
import { screen, render } from "../lib/test-utils";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { ArticleList } from "@/components/article/article-list";

// --- Mock LLM scoring ---
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    });
  },
  TaskType: {
    RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
    RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
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
            usefulness: 6,
            ntt_relevance: 8,
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
    keyword TEXT,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
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
    expect(await getScoredArticles()).toHaveLength(0);

    const fetched: NormalizedArticle[] = Array.from({ length: ARTICLE_COUNT }).map((_, i) => ({
      title: `取得記事 ${i}: に関する解説`,
      description: `これは記事 ${i} の説明です。AI と半導体について扱っています。`,
      url: `http://test.com/display/${i}`,
      urlToImage: null,
      publishedAt: new Date().toISOString(),
      sourceName: "Test Source",
      sourceId: "test-source",
      author: "Test Author",
    }));

    const savedCount = await scoreAndSaveTagged(fetched);
    const scored = await getScoredArticles(100);

    expect(savedCount).toBe(ARTICLE_COUNT);
    expect(scored).toHaveLength(ARTICLE_COUNT);
    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.summary).not.toBeNull();
      expect(a.usefulness).not.toBeNull();
    }

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ids: [] }),
    } as Response);
    render(React.createElement(ArticleList, { articles: scored }));
    for (const a of fetched) {
      expect(screen.getByText(a.title)).toBeInTheDocument();
    }
    for (const a of scored) {
      const scoreElements = screen.getAllByText(String(a.score));
      expect(scoreElements.length).toBeGreaterThan(0);
      if (a.summary) {
        expect(a.summary).toMatch(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
      }
    }

    const unscoredList = scored.filter((a) => a.score === null);
    expect(unscoredList).toHaveLength(0);
  }, 30000);
});
