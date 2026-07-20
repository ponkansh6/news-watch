import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { discoverHatenaFeeds } from "@/lib/news/hatena-discovery";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeAll(async () => {
  vi.useFakeTimers();
});

beforeEach(async () => {
  await db.$client.execute(`DELETE FROM hatena_feeds`);
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("discoverHatenaFeeds", () => {
  test("extracts domains from RSS and upserts feeds", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes(".rss")) {
        return {
          ok: true,
          text: async () => `
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
              <item rdf:about="https://user1.hatenablog.com/entry/1">
                <link>https://user1.hatenablog.com/entry/1</link>
              </item>
              <item>
                <link>https://user2.hatenablog.com/entry/2</link>
              </item>
            </rdf:RDF>
          `,
        };
      }
      return new Response("<html></html>", { status: 200 });
    });

    const promise = discoverHatenaFeeds();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.discovered).toBe(2);
    expect(result.updated).toBe(0);

    const rows = await db.select().from(hatenaFeeds);
    expect(rows.map((r) => r.domain).sort()).toEqual(
      ["user1.hatenablog.com", "user2.hatenablog.com"].sort(),
    );
    expect(rows[0].feedUrl).toBe("https://user1.hatenablog.com/rss");
  });

  test("dedups by domain and reactivates on re-discovery", async () => {
    // pre-existing row marked as error
    await db.insert(hatenaFeeds).values({
      domain: "user1.hatenablog.com",
      feedUrl: "https://user1.hatenablog.com/rss",
      status: "error",
      errorCount: 9,
      bookmarkCount: 3,
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes(".rss")) {
        return {
          ok: true,
          text: async () => `
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
              <item rdf:about="https://user1.hatenablog.com/entry/1">
                <link>https://user1.hatenablog.com/entry/1</link>
              </item>
            </rdf:RDF>
          `,
        };
      }
      return new Response("<html></html>", { status: 200 });
    });

    const promise = discoverHatenaFeeds();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.discovered).toBe(0);
    expect(result.updated).toBe(1);

    const rows = await db.select().from(hatenaFeeds);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active"); // reactivated
    expect(rows[0].errorCount).toBe(0);
  });

  test("records error when RSS fetch fails", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes(".rss")) return { ok: false, status: 404 };
      return new Response("<html></html>", { status: 200 });
    });

    const promise = discoverHatenaFeeds();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.discovered).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    const rows = await db.select().from(hatenaFeeds);
    expect(rows).toHaveLength(0);
  });
});
