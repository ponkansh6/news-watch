import { describe, expect, test, vi } from "vitest";
import { SOURCES, SOURCE_IDS } from "@/lib/sources";
import { SUPPORTED_SOURCE_IDS } from "@/app/api/fetch-news/route";

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

describe("取得ソースとUIのリンク検証", () => {
  test("UIのソース一覧とバックエンドの対応ソースが一致する", () => {
    const uiIds = [...SOURCE_IDS].sort();
    const backendIds = [...SUPPORTED_SOURCE_IDS].sort();
    expect(uiIds).toEqual(backendIds);
  });

  test("バックエンドが扱う全ソースが UI にも存在する", () => {
    const uiIdSet = new Set(SOURCES.map((s) => s.id));
    for (const id of SUPPORTED_SOURCE_IDS) {
      expect(uiIdSet.has(id), `UIに ${id} が存在しない`).toBe(true);
    }
  });

  test("zdnet が両方に含まれ、UI に表示名が設定されている", () => {
    expect(SUPPORTED_SOURCE_IDS).toContain("zdnet");
    const zdnet = SOURCES.find((s) => s.id === "zdnet");
    expect(zdnet).toBeDefined();
    expect(zdnet?.name).toBe("ZDNet Japan");
  });
});
