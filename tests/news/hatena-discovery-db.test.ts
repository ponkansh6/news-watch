import { beforeAll, describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { getActiveFeedUrls, recordFeedError, recordFeedSuccess } from "@/lib/news/hatena-discovery";

beforeAll(async () => {
  // Create table in in-memory DB
  await db.run(sql`CREATE TABLE IF NOT EXISTS hatena_feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    feed_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    bookmark_count INTEGER NOT NULL DEFAULT 0,
    last_fetched_at TEXT,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
});

describe("hatena-discovery DB integration", () => {
  test("getActiveFeedUrls returns only active feeds", async () => {
    await db.insert(hatenaFeeds).values([
      { domain: "a.hatenablog.com", feedUrl: "https://a.hatenablog.com/rss", status: "active" },
      { domain: "b.hatenablog.com", feedUrl: "https://b.hatena.com/rss", status: "inactive" },
    ]);

    const urls = await getActiveFeedUrls();
    expect(urls).toContain("https://a.hatenablog.com/rss");
    expect(urls).not.toContain("https://b.hatena.com/rss");
  });

  test("recordFeedError increments count and disables at threshold", async () => {
    await db.insert(hatenaFeeds).values({
      domain: "error.hatenablog.com",
      feedUrl: "https://error.hatenablog.com/rss",
      status: "active",
      errorCount: 4,
    });

    await recordFeedError("error.hatenablog.com", "Timeout");

    const feed = await db
      .select()
      .from(hatenaFeeds)
      .where(sql`domain = 'error.hatenablog.com'`)
      .get();
    expect(feed?.errorCount).toBe(5);
    expect(feed?.status).toBe("error");
  });

  test("recordFeedSuccess resets error count", async () => {
    await db.insert(hatenaFeeds).values({
      domain: "success.hatenablog.com",
      feedUrl: "https://success.hatenablog.com/rss",
      status: "error",
      errorCount: 3,
    });

    await recordFeedSuccess("success.hatenablog.com");

    const feed = await db
      .select()
      .from(hatenaFeeds)
      .where(sql`domain = 'success.hatenablog.com'`)
      .get();
    expect(feed?.errorCount).toBe(0);
    expect(feed?.status).toBe("active");
  });
});
