import { expect, test, describe } from "vitest";
import { cosineSimilarity } from "../../src/lib/embeddings";

describe("vector filtering", () => {
  test("should filter articles based on cosine similarity threshold", () => {
    // Mock embeddings (normalized for simplicity, though cosineSimilarity handles non-normalized)
    const queryVector = [1, 0, 0];

    const articles = [
      { id: 1, title: "Relevant Article", embedding: [0.9, 0.1, 0] }, // High similarity
      { id: 2, title: "Somewhat Relevant", embedding: [0.7, 0.7, 0] }, // Medium similarity
      { id: 3, title: "Irrelevant Article", embedding: [0, 1, 0] }, // Low similarity
    ];

    const threshold = 0.75;

    const filteredArticles = articles.filter((article) => {
      const similarity = cosineSimilarity(queryVector, article.embedding);
      return similarity >= threshold;
    });

    // Calculate similarities to verify
    // 1: (1*0.9 + 0*0.1 + 0*0) / (1 * sqrt(0.9^2 + 0.1^2)) = 0.9 / sqrt(0.82) ≈ 0.99
    // 2: (1*0.7 + 0*0.7 + 0*0) / (1 * sqrt(0.7^2 + 0.7^2)) = 0.7 / sqrt(0.98) ≈ 0.707
    // 3: (1*0 + 0*1 + 0*0) / (1 * sqrt(0^2 + 1^2)) = 0

    expect(filteredArticles).toHaveLength(1);
    expect(filteredArticles[0].id).toBe(1);
  });

  test("cosineSimilarity should return 0 for orthogonal vectors", () => {
    const vecA = [1, 0];
    const vecB = [0, 1];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  test("cosineSimilarity should return 1 for identical vectors", () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2, 3];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1);
  });
});
