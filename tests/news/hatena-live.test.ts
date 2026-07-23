import { describe, it, expect, vi, afterAll } from "vitest";

describe("live Hatena connection", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch real Hatena RSS feeds", async () => {
    const rssUrl = "https://b.hatena.ne.jp/hotentry/it.rss";
    const res = await fetch(rssUrl, {
      headers: {
        "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
      },
    });
    expect(res.ok).toBe(true);
    const xml = await res.text();
    expect(xml).toContain("<item");
    console.log(`[live] RSS fetch OK`);
  });
});
