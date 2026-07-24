/**
 * 各データソースの normalize 誤判定（misclassification）検知テスト
 *
 * 過去のバグ:
 * - CodeZine が ITmedia と同じ `guid` を持つため ITmedia として誤判定されていた
 * - ZDNet Japan が `guid` を持たず `link` のみのため Yamadashy(Tech Blog) として誤判定されていた
 *
 * これらのフィクスチャは意図的に重複プロパティ（guid / link）を持つよう作られており、
 * normalize が sourceId ではなくプロパティ判定に戻った場合に失敗する。
 */
import { describe, expect, test, vi } from "vitest";
import { normalize } from "@/app/api/fetch-news/route";
import type { NewsApiArticle } from "@/lib/news/newsapi";
import type { QiitaFeedItem } from "@/lib/news/qiita";
import type { YamadashyItem } from "@/lib/news/yamadashy";
import type { ItmediaItem } from "@/lib/news/itmedia";
import type { CodeZineItem } from "@/lib/news/codezine";
import type { ZdnetItem } from "@/lib/news/zdnet";

// route.ts がトップレベルで import する副作用のあるモジュールをモックして、
// テスト環境で route モジュールを安全にロードする（normalize 自体は純粋関数）。
vi.mock("@/lib/config", () => ({
  get KEYWORDS() {
    return ["TypeScript"];
  },
}));
vi.mock("@/lib/db/actions", () => ({
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/llm/gemini", () => ({ scoreArticles: vi.fn(), scoreArticle: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn(),
  embedQuery: vi.fn(),
  batchEmbed: vi.fn(),
  cosineSimilarity: vi.fn(),
}));
vi.mock("@/lib/score-pipeline", () => ({ scoreAndSaveTagged: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/vector-filter", () => ({ tagArticlesByKeyword: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/scoring", () => ({ calcRecencyScore: vi.fn(), calcCompositeScore: vi.fn() }));

describe("normalize: 各データソースの誤判定検知", () => {
  test("NewsAPI: sourceName にメディア名、url/author が正しくマップされる", () => {
    const a: NewsApiArticle = {
      title: "N",
      description: "d",
      url: "https://example.com/n",
      urlToImage: null,
      publishedAt: "2026-07-01T00:00:00Z",
      source: { name: "Example News", id: null },
      author: "John",
    };
    const r = normalize(a, "newsapi");
    expect(r.sourceId).toBe("newsapi");
    expect(r.sourceName).toBe("Example News");
    expect(r.url).toBe("https://example.com/n");
    expect(r.author).toBe("John");
    expect(r.publishedAt).toBe("2026-07-01T00:00:00Z");
  });

  test("Qiita: link オブジェクトから URL が抽出され、sourceName=Qiita", () => {
    const a: QiitaFeedItem = {
      id: "q1",
      title: "Q",
      link: { "@_href": "https://qiita.com/u/items/abc" },
      published: "2026-07-02T00:00:00Z",
      updated: "2026-07-02T00:00:00Z",
      author: { name: "u" },
      content: "body",
    };
    const r = normalize(a, "qiita");
    expect(r.sourceId).toBe("qiita");
    expect(r.sourceName).toBe("Qiita");
    expect(r.url).toBe("https://qiita.com/u/items/abc");
    expect(r.author).toBe("u");
    expect(r.publishedAt).toBe("2026-07-02T00:00:00Z");
  });

  test("Yamadashy: sourceName=Tech Blog", () => {
    const a: YamadashyItem = {
      title: "Y",
      link: "https://techblog.com/y",
      description: "d",
      pubDate: "2026-07-04T00:00:00Z",
      author: "ya",
    };
    const r = normalize(a, "yamadashy");
    expect(r.sourceId).toBe("yamadashy");
    expect(r.sourceName).toBe("Tech Blog");
    expect(r.url).toBe("https://techblog.com/y");
    expect(r.author).toBe("ya");
    expect(r.publishedAt).toBe("2026-07-04T00:00:00Z");
  });

  test("ITmedia: sourceName=@IT", () => {
    const a: ItmediaItem = {
      title: "I",
      link: "https://www.itmedia.co.jp/i",
      description: "d",
      pubDate: "2026-07-05T00:00:00Z",
      guid: "guid-i",
    };
    const r = normalize(a, "itmedia");
    expect(r.sourceId).toBe("itmedia");
    expect(r.sourceName).toBe("@IT");
    expect(r.url).toBe("https://www.itmedia.co.jp/i");
    expect(r.author).toBeNull();
    expect(r.publishedAt).toBe("2026-07-05T00:00:00Z");
  });

  test("CodeZine: sourceName=CodeZine（guid を持つため ITmedia と衝突しない）", () => {
    const a: CodeZineItem = {
      title: "C",
      link: "https://codezine.jp/c",
      description: "d",
      pubDate: "2026-07-06T00:00:00Z",
      guid: "guid-c",
    };
    const r = normalize(a, "codezine");
    expect(r.sourceId).toBe("codezine");
    expect(r.sourceName).toBe("CodeZine");
    expect(r.url).toBe("https://codezine.jp/c");
    expect(r.author).toBeNull();
    expect(r.publishedAt).toBe("2026-07-06T00:00:00Z");
  });

  test("ZDNet Japan: sourceName=ZDNet Japan（link のみで guid がないため Yamadashy と誤判定されない）", () => {
    const a: ZdnetItem = {
      title: "Z",
      link: "https://japan.zdnet.com/article/z",
      description: "d",
      date: "2026-07-07T00:00:00Z",
      creator: "zc",
    };
    const r = normalize(a, "zdnet");
    expect(r.sourceId).toBe("zdnet");
    expect(r.sourceName).toBe("ZDNet Japan");
    expect(r.url).toBe("https://japan.zdnet.com/article/z");
    expect(r.author).toBe("zc");
    expect(r.publishedAt).toBe("2026-07-07T00:00:00Z");
  });

  test("回帰: CodeZine フィクスチャが ITmedia にならない", () => {
    const a: CodeZineItem = {
      title: "C",
      link: "https://codezine.jp/c",
      pubDate: "2026-07-06T00:00:00Z",
      guid: "guid-c",
    };
    const r = normalize(a, "codezine");
    expect(r.sourceName).not.toBe("ITmedia");
    expect(r.sourceName).toBe("CodeZine");
  });

  test("回帰: ZDNet フィクスチャが Tech Blog(Yamadashy) にならない", () => {
    const a: ZdnetItem = {
      title: "Z",
      link: "https://japan.zdnet.com/article/z",
      date: "2026-07-07T00:00:00Z",
      creator: "zc",
    };
    const r = normalize(a, "zdnet");
    expect(r.sourceName).not.toBe("Tech Blog");
    expect(r.sourceName).toBe("ZDNet Japan");
  });
});
