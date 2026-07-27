import { describe, expect, test } from "vitest";
import { cosineSimilarity } from "@/lib/vector-math";

describe("cosineSimilarity", () => {
  test("Identical vectors -> 1.0", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test("Orthogonal vectors -> 0.0", () => {
    const vA = [1, 0, 0];
    const vB = [0, 1, 0];
    expect(cosineSimilarity(vA, vB)).toBeCloseTo(0.0, 5);
  });

  test("Opposite vectors -> -1.0", () => {
    const vA = [1, 2, 3];
    const vB = [-1, -2, -3];
    expect(cosineSimilarity(vA, vB)).toBeCloseTo(-1.0, 5);
  });

  test("Vectors of different lengths should throw an error", () => {
    const vA = [1, 2];
    const vB = [1, 2, 3];
    expect(() => cosineSimilarity(vA, vB)).toThrow("Vectors must have the same length");
  });

  test("Zero vector -> handle division by zero (returns 0)", () => {
    const vA = [0, 0, 0];
    const vB = [1, 2, 3];
    expect(cosineSimilarity(vA, vB)).toBe(0);
    expect(cosineSimilarity(vB, vA)).toBe(0);
    expect(cosineSimilarity(vA, vA)).toBe(0);
  });

  test("Positive similarity for similar vectors", () => {
    const vA = [1, 2, 3];
    const vB = [1.1, 2.1, 2.9];
    const sim = cosineSimilarity(vA, vB);
    expect(sim).toBeGreaterThan(0.95);
    expect(sim).toBeLessThanOrEqual(1.0);
  });
});
