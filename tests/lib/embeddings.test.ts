import { describe, expect, test, vi, beforeEach } from "vitest";
import { cosineSimilarity } from "@/lib/embeddings";

describe("embeddings (module level & cosineSimilarity)", () => {
  test("cosineSimilarity works correctly", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});
