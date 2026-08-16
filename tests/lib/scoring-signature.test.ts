import { describe, expect, test } from "vitest";
import { computeContentHash, computeScoringSignature } from "@/lib/scoring-signature";

describe("scoring-signature", () => {
  test("computeContentHash is deterministic and handles null/empty description", () => {
    const h1 = computeContentHash("Title A", "Description A");
    const h2 = computeContentHash("Title A", "Description A");
    const h3 = computeContentHash("Title A", null);
    const h4 = computeContentHash("Title A", "");
    const h5 = computeContentHash("Title B", "Description A");

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h3).toBe(h4);
    expect(h1).not.toBe(h5);
    expect(h1.length).toBe(16);
  });

  test("computeScoringSignature is deterministic and changes on version/sections", () => {
    const s1 = computeScoringSignature("tech");
    const s2 = computeScoringSignature("tech");
    const s3 = computeScoringSignature("business");

    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1.length).toBe(16);
  });
});
