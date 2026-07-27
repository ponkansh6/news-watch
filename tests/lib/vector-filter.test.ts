import { describe, expect, test, vi, beforeEach } from "vitest";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import type { NormalizedArticle } from "@/lib/types";

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => [],
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
  },
}));

const mockBatchEmbed = vi.fn();
// Do NOT mock cosineSimilarity here; let it run the real cosineSimilarity so bestSim equals the actual calculated similarity!

vi.mock("@/lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings")>();
  return {
    ...actual,
    batchEmbed: (...args: any[]) => mockBatchEmbed(...args),
    EMBEDDING_MODEL_VERSION: "gemini-embedding-2",
  };
});

describe("tagArticlesByKeyword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleArticle: NormalizedArticle = {
    title: "Test Article",
    description: "Test Description",
    url: "https://example.com/art1",
    urlToImage: null,
    publishedAt: "2026-07-27T00:00:00Z",
    sourceName: "Test",
    sourceId: "test",
    author: null,
  };

  test("empty keywords array -> returns articles with empty/null tags", async () => {
    const results = await tagArticlesByKeyword([sampleArticle], []);
    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe("");
    expect(results[0].similarity).toBe(0);
    expect(mockBatchEmbed).not.toHaveBeenCalled();
  });

  test("empty articles array -> returns empty array", async () => {
    mockBatchEmbed.mockResolvedValueOnce([]);
    const results = await tagArticlesByKeyword([], ["TypeScript"]);
    expect(results).toHaveLength(0);
  });

  test("Articles above threshold get tagged with best keyword", async () => {
    // Keyword embedding [1, 0], Article embedding [1, 0] -> cosine similarity = 1.0 (>= 0.6 threshold)
    mockBatchEmbed.mockResolvedValueOnce([
      [1, 0], // keyword
      [1, 0], // article
    ]);

    const results = await tagArticlesByKeyword([sampleArticle], ["TypeScript"]);

    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe("TypeScript");
    expect(results[0].similarity).toBeCloseTo(1.0, 5);
  });

  test("Articles below threshold get keyword=null", async () => {
    // Keyword embedding [1, 0], Article embedding [0, 1] -> cosine similarity = 0.0 (< 0.6 threshold)
    mockBatchEmbed.mockResolvedValueOnce([
      [1, 0], // keyword
      [0, 1], // article
    ]);

    const results = await tagArticlesByKeyword([sampleArticle], ["TypeScript"]);

    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBeNull();
    expect(results[0].similarity).toBeCloseTo(0.0, 5);
  });

  test("Multiple keywords: each article gets the closest match", async () => {
    // Keywords: TypeScript [1, 0], Rust [0, 1]
    // Article: [0.9, 0.1] -> closer to TypeScript
    mockBatchEmbed.mockResolvedValueOnce([
      [1, 0],
      [0, 1],
      [0.9, 0.1],
    ]);

    const results = await tagArticlesByKeyword([sampleArticle], ["TypeScript", "Rust"]);

    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe("TypeScript");
    expect(results[0].similarity).toBeGreaterThan(0.8);
  });
});
