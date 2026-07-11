import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { POST } from "@/app/api/scoring-status/route";
import { upsertArticle, getScoredArticles } from "@/lib/db/actions";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";

// Helper to clear database
async function clearDb() {
  try {
    await db.delete(articles);
  } catch {
    // Table may not exist yet if migrate hasn't run
  }
}

describe("Scoring Polling API", () => {
  beforeAll(async () => {
    await db.run(sql`DROP TABLE IF EXISTS articles`);
    await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
  });

  beforeEach(async () => {
    await clearDb();
  });

  it("should only count articles scored after the 'since' timestamp", async () => {
    const keyword = "test-keyword";
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // 1. Insert 5 "old" articles (scored yesterday)
    for (let i = 0; i < 5; i++) {
      await upsertArticle({
        title: `Old ${i}`,
        description: null,
        url: `http://old${i}.com`,
        urlToImage: null,
        publishedAt: yesterday.toISOString(),
        sourceName: "test",
        sourceId: "test",
        author: null,
        keyword,
        summary: "old",
        relevance: 1,
        usefulness: 1,
        recency: 1,
        reason: "old",
        scoredAt: yesterday.toISOString(),
        score: 5,
        embedding: null,
      });
    }

    // 2. Insert 3 "new" articles (scored now)
    const since = oneHourAgo.toISOString();
    for (let i = 0; i < 3; i++) {
      await upsertArticle({
        title: `New ${i}`,
        description: null,
        url: `http://new${i}.com`,
        urlToImage: null,
        publishedAt: now.toISOString(),
        sourceName: "test",
        sourceId: "test",
        author: null,
        keyword,
        summary: "new",
        relevance: 1,
        usefulness: 1,
        recency: 1,
        reason: "new",
        scoredAt: now.toISOString(),
        score: 5,
        embedding: null,
      });
    }

    // 3. Call the API
    const request = new Request("http://localhost/api/scoring-status", {
      method: "POST",
      body: JSON.stringify({ keywords: [keyword], since }),
    });

    const response = await POST(request);
    const data = await response.json();

    // 4. Verify API response
    expect(data.status).toBeDefined();
    const result = data.status.find((s: any) => s.keyword === keyword);
    expect(result.scored).toBe(3); // Should only count the 3 new ones

    // 5. Verify getScoredArticles
    const scoredArticles = await getScoredArticles();
    expect(scoredArticles.length).toBe(8); // Should include all 8 articles
  });
});
