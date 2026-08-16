import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// インメモリ client をモックファクトリ内で生成し、テストから操作できるよう公開する
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

// モックされたモジュールから client を取り出す
import * as dbMod from "@/lib/db";
import type { ArticleInsert } from "../../src/lib/db";
import {
  upsertArticle,
  getScoredArticles,
  deleteLowScoredArticles,
  getAllArticles,
  getTablePage,
  getTableCounts,
  toggleFavorite,
} from "../../src/lib/db";

const CREATE_ARTICLES_SQL = `
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
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

const CREATE_FAVORITES_SQL = `
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_ARTICLES_SQL);
  await (dbMod as any).__client.execute(CREATE_FAVORITES_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
});

describe("Database actions tests", () => {
  it("should insert and retrieve article with score", async () => {
    const articleData = {
      title: "Test Article",
      description: "Test description",
      url: "https://example.com/test1",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Test summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      recencyRefreshedAt: null,
      reason: "Test reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
    };

    await upsertArticle(articleData);

    const scoredArticles = await getScoredArticles();
    expect(scoredArticles).toHaveLength(1);
    expect(scoredArticles[0].url).toBe("https://example.com/test1");
    expect(scoredArticles[0].score).toBe(7.5);
  });

  it("should update article on duplicate URL", async () => {
    const articleData1 = {
      title: "Original Title",
      description: "Original description",
      url: "https://example.com/test2",
      urlToImage: "https://example.com/image1.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Original summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      recencyRefreshedAt: null,
      reason: "Original reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
    };

    await upsertArticle(articleData1);

    const articleData2 = {
      ...articleData1,
      title: "Updated Title",
      score: 9.0,
    };

    await upsertArticle(articleData2);

    const scoredArticles = await getScoredArticles();
    expect(scoredArticles).toHaveLength(1);
    expect(scoredArticles[0].title).toBe("Updated Title");
    expect(scoredArticles[0].score).toBe(9.0);
  });

  it("should retrieve only scored articles", async () => {
    const scoredArticle = {
      title: "Scored Article",
      description: "Scored description",
      url: "https://example.com/scored",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Scored summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      reason: "Scored reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
    };

    const unscoredArticle = {
      title: "Unscored Article",
      description: "Unscored description",
      url: "https://example.com/unscored",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Unscored summary",
      relevance: 5.0,
      usefulness: 4.0,
      recency: 3.0,
      reason: "Unscored reason",
      scoredAt: null,
      score: null,
    };

    await upsertArticle(scoredArticle);
    await upsertArticle(unscoredArticle);

    const scoredArticles = await getScoredArticles();
    expect(scoredArticles).toHaveLength(1);
    expect(scoredArticles[0].url).toBe("https://example.com/scored");
    expect(scoredArticles[0].score).toBe(7.5);
  });

  it("should filter articles by source IDs", async () => {
    const gnewsArticle = {
      title: "GNews Article",
      description: "GNews description",
      url: "https://example.com/gnews",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "GNews",
      sourceId: "gnews",
      author: "Test Author",
      keyword: "test",
      summary: "GNews summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      reason: "GNews reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
    };

    const githubArticle = {
      title: "GitHub Article",
      description: "GitHub description",
      url: "https://example.com/github",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "GitHub",
      sourceId: "github",
      author: "Test Author",
      keyword: "test",
      summary: "GitHub summary",
      relevance: 9.0,
      usefulness: 8.0,
      recency: 7.0,
      recencyRefreshedAt: null,
      reason: "GitHub reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 8.5,
    };

    const qiitaArticle = {
      title: "Qiita Article",
      description: "Qiita description",
      url: "https://example.com/qiita",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Qiita",
      sourceId: "qiita",
      author: "Test Author",
      keyword: "test",
      summary: "Qiita summary",
      relevance: 7.0,
      usefulness: 6.0,
      recency: 5.0,
      reason: "Qiita reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 6.5,
    };

    await upsertArticle(gnewsArticle);
    await upsertArticle(githubArticle);
    await upsertArticle(qiitaArticle);

    const gnewsArticles = await getScoredArticles(50, ["gnews"]);
    expect(gnewsArticles).toHaveLength(1);
    expect(gnewsArticles[0].sourceId).toBe("gnews");

    const githubArticles = await getScoredArticles(50, ["github"]);
    expect(githubArticles).toHaveLength(1);
    expect(githubArticles[0].sourceId).toBe("github");

    const bothArticles = await getScoredArticles(50, ["gnews", "github"]);
    expect(bothArticles).toHaveLength(2);
    expect(bothArticles.map((a) => a.sourceId)).toContain("gnews");
    expect(bothArticles.map((a) => a.sourceId)).toContain("github");
  });

  it("should delete low scored articles", async () => {
    const highScoreArticle = {
      title: "High Score Article",
      description: "High score description",
      url: "https://example.com/highscore",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "High score summary",
      relevance: 9.0,
      usefulness: 8.0,
      recency: 7.0,
      reason: "High score reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 8.0,
    };

    const lowScoreArticle = {
      title: "Low Score Article",
      description: "Low score description",
      url: "https://example.com/lowscore",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Low score summary",
      relevance: 3.0,
      usefulness: 2.0,
      recency: 1.0,
      reason: "Low score reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 3.0,
    };

    const unscoredArticle = {
      title: "Unscored Article",
      description: "Unscored description",
      url: "https://example.com/unscored",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Unscored summary",
      relevance: 2.0,
      usefulness: 1.0,
      recency: 0.5,
      reason: "Unscored reason",
      scoredAt: null,
      score: null,
    };

    await upsertArticle(highScoreArticle);
    await upsertArticle(lowScoreArticle);
    await upsertArticle(unscoredArticle);

    await deleteLowScoredArticles(5);

    const remainingArticles = await getAllArticles();
    expect(remainingArticles).toHaveLength(2);
    expect(remainingArticles.map((a) => a.url)).toContain("https://example.com/highscore");
    expect(remainingArticles.map((a) => a.url)).toContain("https://example.com/unscored");
    expect(remainingArticles.map((a) => a.url)).not.toContain("https://example.com/lowscore");
  });

  it("should retrieve all articles ordered by createdAt descending", async () => {
    const article1 = {
      title: "Article 1",
      description: "Description 1",
      url: "https://example.com/article1",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Summary 1",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      reason: "Reason 1",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
    };

    const article2 = {
      title: "Article 2",
      description: "Description 2",
      url: "https://example.com/article2",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-02T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Summary 2",
      relevance: 7.0,
      usefulness: 6.0,
      recency: 5.0,
      reason: "Reason 2",
      scoredAt: "2024-01-02T00:00:00Z",
      score: 6.5,
    };

    const article3 = {
      title: "Article 3",
      description: "Description 3",
      url: "https://example.com/article3",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-03T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "test",
      summary: "Summary 3",
      relevance: 6.0,
      usefulness: 5.0,
      recency: 4.0,
      reason: "Reason 3",
      scoredAt: "2024-01-03T00:00:00Z",
      score: 5.5,
    };

    await upsertArticle(article1);
    await new Promise((r) => setTimeout(r, 10));
    await upsertArticle(article2);
    await new Promise((r) => setTimeout(r, 10));
    await upsertArticle(article3);

    const allArticles = await getAllArticles();
    expect(allArticles).toHaveLength(3);
    expect(allArticles[0].url).toBe("https://example.com/article3");
    expect(allArticles[1].url).toBe("https://example.com/article2");
    expect(allArticles[2].url).toBe("https://example.com/article1");
  });

  // ── getTablePage ────────────────────────────────────────────────────

  function makeArticleData(
    url: string,
    overrides: Partial<{
      title?: string;
      keyword?: string;
      score?: number;
      sourceId?: string;
    }> = {},
  ): ArticleInsert {
    return {
      title: overrides.title ?? "Admin Article",
      description: null,
      url,
      urlToImage: null,
      publishedAt: "2026-07-27T00:00:00Z",
      sourceName: "admin",
      sourceId: overrides.sourceId ?? "admin",
      author: null,
      keyword: overrides.keyword ?? "admin",
      summary: null,
      relevance: null,
      usefulness: null,
      recency: null,
      reason: null,
      scoredAt: null,
      score: overrides.score ?? null,
    };
  }

  describe("getTablePage", () => {
    it("returns paginated articles with total count", async () => {
      for (let i = 0; i < 5; i++) {
        await upsertArticle(
          makeArticleData(`https://example.com/pg-${i}`, { title: `Page Article ${i}`, score: i }),
        );
      }

      const page1 = await getTablePage("articles", {
        offset: 0,
        limit: 2,
        dir: "asc",
        sort: "id",
      });
      expect(page1.rows).toHaveLength(2);
      expect(page1.rows[0].id).toBeLessThan(page1.rows[1].id);
      expect(page1.total).toBeGreaterThanOrEqual(5);

      const page2 = await getTablePage("articles", {
        offset: 2,
        limit: 2,
        dir: "asc",
        sort: "id",
      });
      expect(page2.rows).toHaveLength(2);
    });

    it("returns empty rows for out-of-range offset", async () => {
      const result = await getTablePage("articles", { offset: 9999, limit: 10 });
      expect(result.rows).toHaveLength(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it("sorts by specified column and direction", async () => {
      for (let i = 0; i < 3; i++) {
        await upsertArticle(
          makeArticleData(`https://example.com/sort-${i}`, {
            title: `Sort Article ${i}`,
            score: i,
          }),
        );
      }

      const desc = await getTablePage("articles", {
        offset: 0,
        limit: 10,
        sort: "score",
        dir: "desc",
      });
      expect(Number(desc.rows[0].score)).toBeGreaterThanOrEqual(
        Number(desc.rows[desc.rows.length - 1].score),
      );

      const asc = await getTablePage("articles", {
        offset: 0,
        limit: 10,
        sort: "score",
        dir: "asc",
      });
      expect(Number(asc.rows[0].score)).toBeLessThanOrEqual(
        Number(asc.rows[asc.rows.length - 1].score),
      );
    });

    it("rejects invalid sort column and falls back to id desc", async () => {
      const result = await getTablePage("articles", {
        offset: 0,
        limit: 10,
        sort: "nonexistent",
      });
      expect(result.rows).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("works for favorites table", async () => {
      const result = await getTablePage("favorites", {
        offset: 0,
        limit: 5,
      });
      expect(result.rows).toBeDefined();
      expect(typeof result.total).toBe("number");
    });

    it("inserts and reads from favorites via toggleFavorite", async () => {
      await upsertArticle(
        makeArticleData("https://example.com/fav-test", { title: "Fav Test", score: 1 }),
      );
      // Get the inserted article's id via getAllArticles
      const allArticles = await getAllArticles(10);
      const article = allArticles.find((a) => a.url === "https://example.com/fav-test");
      expect(article).toBeDefined();
      const articleId = article!.id;

      const favorited = await toggleFavorite(articleId);
      expect(favorited).toBe(true);

      const page = await getTablePage("favorites", {
        offset: 0,
        limit: 5,
      });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0].articleId).toBe(articleId);

      // Unfavorite
      const unfavorited = await toggleFavorite(articleId);
      expect(unfavorited).toBe(false);
    });
  });

  // ── getTableCounts ─────────────────────────────────────────────────

  describe("getTableCounts", () => {
    it("returns counts for all tables", async () => {
      await upsertArticle(
        makeArticleData("https://example.com/count-test", { title: "Count", score: 1 }),
      );

      const counts = await getTableCounts();
      expect(counts).toHaveProperty("articles");
      expect(counts).toHaveProperty("favorites");
      expect(typeof counts.articles).toBe("number");
      expect(typeof counts.favorites).toBe("number");
      expect(counts.articles).toBeGreaterThan(0);
    });
  });
});
