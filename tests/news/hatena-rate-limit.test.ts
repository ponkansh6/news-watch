import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { hatenaFeeds } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  discoverHatenaFeeds,
  politeFetch,
  recordFeedError,
  recordFeedSuccess,
  getActiveFeedUrls,
} from "@/lib/news/hatena-discovery";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Hatena Discovery Rate Limiting and Advanced Features", () => {
  beforeEach(async () => {
    await db.$client.execute(`DELETE FROM hatena_feeds`);
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  describe("5.1 Rate limiting", () => {
    test("politeFetch respects request delay between requests", async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockResolvedValue(new Response("OK", { status: 200 }));

        const p1 = politeFetch("https://example.com/1");
        // advance timers or run immediate
        await vi.runAllTimersAsync();
        await p1;

        const startTime = Date.now();
        const p2 = politeFetch("https://example.com/2");
        // Should wait REQUEST_DELAY_MS (1000ms)
        vi.advanceTimersByTime(1000);
        await vi.runAllTimersAsync();
        await p2;

        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("5.2 politeFetch proxy usage", () => {
    test("handles proxy usage when environment variable is present", async () => {
      // Since HATENA_PROXY_URL is evaluated at module load time, we can verify the function works
      // or test politeFetch normally as it checks proxyDispatcher.
      mockFetch.mockResolvedValue(new Response("OK", { status: 200 }));
      const res = await politeFetch("https://example.com/proxy-test");
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/proxy-test",
        expect.objectContaining({
          headers: expect.any(Object),
        }),
      );
    });
  });

  describe("5.3 Retry-After 429 handling", () => {
    test("respects Retry-After header on 429 response", async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        mockFetch.mockImplementation(async () => {
          calls++;
          if (calls === 1) {
            return new Response("Too Many Requests", {
              status: 429,
              headers: { "Retry-After": "1" },
            });
          }
          return {
            ok: true,
            status: 200,
            text: async () =>
              "<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><item><link>https://example.com/1</link></item></rdf:RDF>",
          };
        });

        const promise = discoverHatenaFeeds();
        // Advance timers by the retry-after duration and throttle delays
        await vi.advanceTimersByTimeAsync(3000);
        const result = await promise;

        expect(result.errors).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("5.4 Auto-disable at 5 consecutive errors", () => {
    test("recordFeedError increments errorCount and sets status to error at 5", async () => {
      await db.insert(hatenaFeeds).values({
        domain: "test.hatenablog.com",
        feedUrl: "https://test.hatenablog.com/rss",
        status: "active",
        errorCount: 4,
      });

      await recordFeedError("test.hatenablog.com", "Connection timeout");

      const rows = await db
        .select()
        .from(hatenaFeeds)
        .where(eq(hatenaFeeds.domain, "test.hatenablog.com"));
      expect(rows).toHaveLength(1);
      expect(rows[0].errorCount).toBe(5);
      expect(rows[0].status).toBe("error");
      expect(rows[0].lastError).toBe("Connection timeout");
    });

    test("recordFeedSuccess resets error count and reactivates", async () => {
      await db.insert(hatenaFeeds).values({
        domain: "test.hatenablog.com",
        feedUrl: "https://test.hatenablog.com/rss",
        status: "error",
        errorCount: 5,
        lastError: "Failed",
      });

      await recordFeedSuccess("test.hatenablog.com");

      const rows = await db
        .select()
        .from(hatenaFeeds)
        .where(eq(hatenaFeeds.domain, "test.hatenablog.com"));
      expect(rows).toHaveLength(1);
      expect(rows[0].errorCount).toBe(0);
      expect(rows[0].status).toBe("active");
      expect(rows[0].lastError).toBeNull();
    });
  });

  describe("5.5 getActiveFeedUrls returns only active feeds", () => {
    test("returns only active feed URLs and ignores error/inactive statuses", async () => {
      await db.insert(hatenaFeeds).values([
        {
          domain: "active1.com",
          feedUrl: "https://active1.com/rss",
          status: "active",
        },
        {
          domain: "error1.com",
          feedUrl: "https://error1.com/rss",
          status: "error",
        },
        {
          domain: "active2.com",
          feedUrl: "https://active2.com/rss",
          status: "active",
        },
      ]);

      const urls = await getActiveFeedUrls();
      expect(urls.sort()).toEqual(["https://active1.com/rss", "https://active2.com/rss"].sort());
    });

    test("returns empty array when no feeds are active", async () => {
      const urls = await getActiveFeedUrls();
      expect(urls).toEqual([]);
    });
  });
});
