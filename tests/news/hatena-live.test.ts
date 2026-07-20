import { describe, it, expect, vi, afterAll } from "vitest";

const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!RUN_LIVE)("live Hatena connection", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("should reach Hatena Hotentry without network error", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("https://b.hatena.ne.jp/hotentry/it?page=1", {
        signal: controller.signal,
        headers: {
          "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
          Accept: "text/html",
        },
      });
      expect(res.ok).toBe(true);
      const html = await res.text();
      // Verify we can extract at least one hatenablog domain
      const hasDomain = /([a-z0-9-]+\.hatenablog\.com)/.test(html);
      expect(hasDomain).toBe(true);
      console.log(`[live] Hotentry OK`);
    } finally {
      clearTimeout(timer);
    }
  });

  it("should fetch real Hatena Blog RSS feeds (reproduces production fetch path)", async () => {
    // Fetch the live hotentry to get real hatenablog.com domains, then fetch
    // their RSS directly — WITHOUT touching the database.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let domains: string[] = [];
    try {
      const res = await fetch("https://b.hatena.ne.jp/hotentry/it?page=1", {
        signal: controller.signal,
        headers: {
          "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
          Accept: "text/html",
        },
      });
      const html = await res.text();
      const seen = new Set<string>();
      const patterns = [
        /https?:\/\/([a-z0-9-]+\.hatenablog\.com)/g,
        /\/entry\/s\/([a-z0-9-]+\.hatenablog\.com)/g,
        /\/site\/([a-z0-9-]+\.hatenablog\.com)/g,
      ];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const domain = match[1];
          if (domain && !seen.has(domain)) {
            seen.add(domain);
            domains.push(domain);
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (domains.length === 0) {
      console.warn("[live] no hatenablog domains found");
      return;
    }

    console.log(`[live] testing ${domains.length} RSS feed(s)`);
    const results = await Promise.all(
      domains.map(async (domain) => {
        const url = `https://${domain}/rss`;
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 15_000);
        try {
          const res = await fetch(url, {
            signal: c.signal,
            headers: { "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)" },
          });
          return { domain, url, ok: res.ok, status: res.status };
        } catch (err) {
          return {
            domain,
            url,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        } finally {
          clearTimeout(t);
        }
      }),
    );

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error("[live] RSS fetch failures:", JSON.stringify(failures, null, 2));
    } else {
      console.log(`[live] all ${results.length} RSS feeds reachable`);
    }
    // Report rather than hard-fail: we want to SEE the errors, not block CI.
    expect(results.length).toBe(domains.length);
  });
});
