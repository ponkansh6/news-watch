import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/lib/db/schema";

// インメモリ client をモックファクトリ内で生成し、テストから操作できるよう公開する
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("../../src/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

// モックされたモジュールから client を取り出す
import * as dbMod from "@/lib/db";
import {
  upsertArticle,
  getScoredArticles,
  deleteOrphanedArticles,
  deleteLowScoredArticles,
  getAllArticles,
} from "../../src/lib/db/actions";

const CREATE_SQL = `
  CREATE TABLE articles (
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

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
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
      reason: "Test reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
      embedding: "test-embedding",
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
      reason: "Original reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
      embedding: "test-embedding-1",
    };

    await upsertArticle(articleData1);

    const articleData2 = {
      ...articleData1,
      title: "Updated Title",
      score: 9.0,
      embedding: "test-embedding-2",
    };

    await upsertArticle(articleData2);

    const scoredArticles = await getScoredArticles();
    expect(scoredArticles).toHaveLength(1);
    expect(scoredArticles[0].title).toBe("Updated Title");
    expect(scoredArticles[0].score).toBe(9.0);
    expect(scoredArticles[0].embedding).toBe("test-embedding-2");
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      reason: "GitHub reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 8.5,
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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

  it("should delete orphaned articles", async () => {
    const aiArticle = {
      title: "AI Article",
      description: "AI description",
      url: "https://example.com/ai",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "ai",
      summary: "AI summary",
      relevance: 8.0,
      usefulness: 7.0,
      recency: 6.0,
      reason: "AI reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 7.5,
      embedding: "test-embedding",
    };

    const webArticle = {
      title: "Web Article",
      description: "Web description",
      url: "https://example.com/web",
      urlToImage: "https://example.com/image.jpg",
      publishedAt: "2024-01-01T00:00:00Z",
      sourceName: "Test Source",
      sourceId: "test",
      author: "Test Author",
      keyword: "web",
      summary: "Web summary",
      relevance: 5.0,
      usefulness: 4.0,
      recency: 3.0,
      reason: "Web reason",
      scoredAt: "2024-01-01T00:00:00Z",
      score: 4.5,
      embedding: "test-embedding",
    };

    await upsertArticle(aiArticle);
    await upsertArticle(webArticle);

    await deleteOrphanedArticles(["ai"]);

    const remainingArticles = await getAllArticles();
    expect(remainingArticles).toHaveLength(1);
    expect(remainingArticles[0].keyword).toBe("ai");
    expect(remainingArticles[0].url).toBe("https://example.com/ai");
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
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
      embedding: "test-embedding",
    };

    await upsertArticle(article1);
    await upsertArticle(article2);
    await upsertArticle(article3);

    const allArticles = await getAllArticles();
    expect(allArticles).toHaveLength(3);
    expect(allArticles[0].url).toBe("https://example.com/article3");
    expect(allArticles[1].url).toBe("https://example.com/article2");
    expect(allArticles[2].url).toBe("https://example.com/article1");
  });
});
