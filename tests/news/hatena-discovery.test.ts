import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { discoverHatenaFeeds } from "@/lib/news/hatena-discovery";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeAll(async () => {
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

beforeEach(async () => {
  await db.run(sql`DELETE FROM hatena_feeds`);
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("discoverHatenaFeeds", () => {
  test("filters only *.hatenablog.com and resolves feed via autodiscovery", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("entrylist/json")) {
        if (url.includes("page=1")) {
          return {
            ok: true,
            json: async () => ({
              entries: [
                { link: "https://user1.hatenablog.com/entry/1", count: 10 },
                { link: "https://other.com/entry/1", count: 100 }, // excluded (not hatenablog.com)
                { link: "https://user2.hatenablog.com/entry/2", count: 5 },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ entries: [] }) };
      }
      // homepage HTML for RSS autodiscovery
      if (url === "https://user1.hatenablog.com") {
        return new Response(
          '<html><head><link rel="alternate" type="application/rss+xml" href="https://user1.hatenablog.com/feed"></head></html>',
          { status: 200 },
        );
      }
      if (url === "https://user2.hatenablog.com") {
        return new Response("<html></html>", { status: 200 }); // no link → fallback /rss
      }
      return new Response("<html></html>", { status: 200 });
    });

    const result = await discoverHatenaFeeds();

    expect(result.discovered).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([]);

    const rows = await db.select().from(hatenaFeeds);
    const user1 = rows.find((r) => r.domain === "user1.hatenablog.com");
    const user2 = rows.find((r) => r.domain === "user2.hatenablog.com");
    const other = rows.find((r) => r.domain === "other.com");
    expect(other).toBeUndefined();
    expect(user1?.feedUrl).toBe("https://user1.hatenablog.com/feed");
    expect(user2?.feedUrl).toBe("https://user2.hatenablog.com/rss");
  });

  test("dedups by domain keeping max bookmarkCount and reactivates on re-discovery", async () => {
    // pre-existing row marked as error
    await db.insert(hatenaFeeds).values({
      domain: "user1.hatenablog.com",
      feedUrl: "https://user1.hatenablog.com/rss",
      status: "error",
      errorCount: 9,
      bookmarkCount: 3,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("entrylist/json")) {
        if (url.includes("page=1")) {
          return {
            ok: true,
            json: async () => ({
              entries: [
                { link: "https://user1.hatenablog.com/entry/1", count: 20 },
                { link: "https://user1.hatenablog.com/entry/2", count: 8 }, // same domain, lower count
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ entries: [] }) };
      }
      return new Response("<html></html>", { status: 200 });
    });

    const result = await discoverHatenaFeeds();

    expect(result.discovered).toBe(0);
    expect(result.updated).toBe(1);

    const rows = await db.select().from(hatenaFeeds);
    expect(rows).toHaveLength(1);
    expect(rows[0].bookmarkCount).toBe(20); // GREATEST kept
    expect(rows[0].status).toBe("active"); // reactivated
    expect(rows[0].errorCount).toBe(0);
  });

  test("records error when Bookmark API page fails", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("entrylist/json")) return { ok: false, status: 404 };
      return new Response("<html></html>", { status: 200 });
    });

    const result = await discoverHatenaFeeds();

    expect(result.discovered).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    const rows = await db.select().from(hatenaFeeds);
    expect(rows).toHaveLength(0);
  });
});
