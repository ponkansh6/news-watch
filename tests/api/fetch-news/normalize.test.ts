import { describe, expect, test, vi, beforeEach } from "vitest";
import { normalize } from "@/app/api/fetch-news/route";

describe("normalize function", () => {
  test("Normalize a Zenn article", () => {
    const zennArticle = {
      title: "Zenn Article Title",
      path: "/articles/zenn-1",
      published_at: "2026-07-27T10:00:00Z",
      user: { name: "Zenn Author", username: "zenn_user" },
      body_letters_count: 1000,
    };

    const normalized = normalize(zennArticle as any, "zenn");

    expect(normalized).toEqual({
      title: "Zenn Article Title",
      description: null,
      url: "https://zenn.dev/articles/zenn-1",
      urlToImage: null,
      publishedAt: "2026-07-27T10:00:00Z",
      sourceName: "Zenn",
      sourceId: "zenn",
      author: "Zenn Author",
    });
  });

  test("Normalize a Qiita article", () => {
    const qiitaArticle = {
      title: "Qiita Article Title",
      link: "https://qiita.com/items/123",
      published: "2026-07-27T11:00:00Z",
      author: { name: "Qiita Author" },
      summary: "Qiita summary",
    };

    const normalized = normalize(qiitaArticle as any, "qiita");

    expect(normalized).toEqual({
      title: "Qiita Article Title",
      description: null,
      url: "https://qiita.com/items/123",
      urlToImage: null,
      publishedAt: "2026-07-27T11:00:00Z",
      sourceName: "Qiita",
      sourceId: "qiita",
      author: "Qiita Author",
    });
  });

  test("Normalize a Hatena article", () => {
    const hatenaArticle = {
      title: "Hatena Article Title",
      link: "https://hatena.blog/entry/1",
      pubDate: "2026-07-27T12:00:00Z",
      author: "Hatena Author",
      description: "Hatena description",
    };

    const normalized = normalize(hatenaArticle as any, "hatena");

    expect(normalized).toEqual({
      title: "Hatena Article Title",
      description: "Hatena description",
      url: "https://hatena.blog/entry/1",
      urlToImage: null,
      publishedAt: "2026-07-27T12:00:00Z",
      sourceName: "Hatena Blog",
      sourceId: "hatena",
      author: "Hatena Author",
    });
  });

  test("Normalize an ITmedia article", () => {
    const itmediaArticle = {
      title: "ITmedia Article Title",
      link: "https://itmedia.co.jp/ait/articles/1",
      pubDate: "2026-07-27T13:00:00Z",
      description: "ITmedia description",
    };

    const normalized = normalize(itmediaArticle as any, "itmedia");

    expect(normalized).toEqual({
      title: "ITmedia Article Title",
      description: "ITmedia description",
      url: "https://itmedia.co.jp/ait/articles/1",
      urlToImage: null,
      publishedAt: "2026-07-27T13:00:00Z",
      sourceName: "@IT",
      sourceId: "itmedia",
      author: null,
    });
  });

  test("Normalize an article with missing optional fields / handles null/undefined gracefully", () => {
    const sparseArticle = {
      title: "Minimal Article",
      link: "https://example.com/minimal",
    };

    const normalized = normalize(sparseArticle as any, "unknown-source");

    expect(normalized.title).toBe("Minimal Article");
    expect(normalized.url).toBe("https://example.com/minimal");
    expect(normalized.sourceId).toBe("unknown-source");
    expect(normalized.sourceName).toBeNull();
    expect(normalized.author).toBeNull();
    expect(normalized.description).toBeNull();
    expect(typeof normalized.publishedAt).toBe("string");
  });
});
