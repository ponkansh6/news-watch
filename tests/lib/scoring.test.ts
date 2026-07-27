import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  calcRecencyScore,
  calcCompositeScore,
  softmax,
  normalizeSimilaritiesWithTagged,
} from "@/lib/scoring";
import { RECENCY_TIERS, SOFTMAX_SCALE } from "@/lib/constants";
import type { ArticleWithTag } from "@/lib/types";

// ================================================================
// calcRecencyScore
// ================================================================
describe("calcRecencyScore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tierTestCases = RECENCY_TIERS.map((tier) => ({
    label: `≤${tier.days}日 → ${tier.score}`,
    daysAgo: tier.days * 0.5, // half the threshold to be safely within
    expected: tier.score,
  }));

  // Add explicit edge cases: exactly at each boundary, just over, and far past
  const edgeCases: { label: string; daysAgo: number; expected: number }[] = [
    // Tier boundaries
    { label: "0日（今日）→ 10", daysAgo: 0, expected: 10 },
    { label: "1日ちょうど → 10", daysAgo: 1, expected: 10 },
    { label: "1日1秒越え → 8", daysAgo: 1 + 1 / 86400, expected: 8 },
    { label: "3日ちょうど → 8", daysAgo: 3, expected: 8 },
    { label: "3日1秒越え → 6", daysAgo: 3 + 1 / 86400, expected: 6 },
    { label: "7日ちょうど → 6", daysAgo: 7, expected: 6 },
    { label: "7日1秒越え → 4", daysAgo: 7 + 1 / 86400, expected: 4 },
    { label: "14日ちょうど → 4", daysAgo: 14, expected: 4 },
    { label: "14日1秒越え → 2", daysAgo: 14 + 1 / 86400, expected: 2 },
    { label: "30日ちょうど → 2", daysAgo: 30, expected: 2 },
    { label: "30日1秒越え → 0", daysAgo: 30 + 1 / 86400, expected: 0 },
    { label: "100日前 → 0", daysAgo: 100, expected: 0 },
  ];

  for (const { label, daysAgo, expected } of edgeCases) {
    test(label, () => {
      const now = Date.now();
      const pubDate = new Date(now - daysAgo * 86400 * 1000).toISOString();
      // Align the fake "now" to the same reference
      vi.setSystemTime(now);
      expect(calcRecencyScore(pubDate)).toBe(expected);
    });
  }

  test("invalid date string returns 0", () => {
    vi.setSystemTime(new Date("2026-07-27T00:00:00Z"));
    expect(calcRecencyScore("not-a-date")).toBe(0);
  });
});

// ================================================================
// calcCompositeScore
// ================================================================
describe("calcCompositeScore", () => {
  // Weights: similarity=0.2, usefulness=0.5, recency=0.3
  // Formula: round((sim*0.2 + use*0.5 + rec*0.3) * 10) / 10

  test("正常計算: (sim=5, use=8, rec=10) → (5*0.2 + 8*0.5 + 10*0.3) = 1+4+3 = 8.0", () => {
    expect(calcCompositeScore(5, 8, 10)).toBe(8.0);
  });

  test("usefulness=null → null を返す", () => {
    expect(calcCompositeScore(5, null, 10)).toBeNull();
  });

  test("similarity が負値 → 0 にクランプ", () => {
    // -1 → 0: (0*0.2 + 8*0.5 + 10*0.3) = 0+4+3 = 7.0
    expect(calcCompositeScore(-1, 8, 10)).toBe(7.0);
  });

  test("similarity が 10超 → 10 にクランプ", () => {
    // 15 → 10: (10*0.2 + 8*0.5 + 10*0.3) = 2+4+3 = 9.0
    expect(calcCompositeScore(15, 8, 10)).toBe(9.0);
  });

  test("小数点第2位で丸められること", () => {
    // (3.333*0.2 + 7.777*0.5 + 5.555*0.3) = 0.6666 + 3.8885 + 1.6665 = 6.2216 → round(62.216)/10 = 6.2
    const result = calcCompositeScore(3.333, 7.777, 5.555);
    expect(result).toBeCloseTo(6.2, 1);
  });

  test("全て最小値: (sim=0, use=0, rec=0) → 0.0", () => {
    expect(calcCompositeScore(0, 0, 0)).toBe(0.0);
  });

  test("全て最大値: (sim=10, use=10, rec=10) → 10.0", () => {
    // (10*0.2 + 10*0.5 + 10*0.3) = 2+5+3 = 10.0
    expect(calcCompositeScore(10, 10, 10)).toBe(10.0);
  });
});

// ================================================================
// softmax
// ================================================================
describe("softmax", () => {
  test("出力の総和が 1 になる", () => {
    const result = softmax([1, 2, 3]);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test("全て同じ値 → 均等 distribution", () => {
    const result = softmax([5, 5, 5, 5]);
    result.forEach((v) => expect(v).toBeCloseTo(0.25, 10));
  });

  test("大きい値ほど高い確率", () => {
    const result = softmax([1, 2, 10]);
    expect(result[2]).toBeGreaterThan(result[1]);
    expect(result[1]).toBeGreaterThan(result[0]);
  });

  test("temperature=∞ → 均等に近づく", () => {
    const result = softmax([1, 10, 100], 1e10);
    result.forEach((v) => expect(v).toBeCloseTo(1 / 3, 2));
  });

  test("single element → 1.0", () => {
    expect(softmax([42])[0]).toBeCloseTo(1.0, 10);
  });
});

// ================================================================
// normalizeSimilaritiesWithTagged
// ================================================================
describe("normalizeSimilaritiesWithTagged", () => {
  const makeTagged = (
    keyword: string | null,
    similarity: number,
    title = "article",
  ): ArticleWithTag => ({
    article: {
      title,
      description: null,
      url: `https://example.com/${title}`,
      urlToImage: null,
      publishedAt: "2026-07-27T00:00:00Z",
      sourceName: "test",
      sourceId: "test",
      author: null,
    },
    embedding: [],
    keyword,
    similarity,
  });

  test("キーワードごとにグループ化し softmax 正規化する", () => {
    const input = [
      makeTagged("TypeScript", 0.9, "ts1"),
      makeTagged("TypeScript", 0.5, "ts2"),
      makeTagged("Rust", 0.8, "rust1"),
      makeTagged("Rust", 0.2, "rust2"),
    ];

    const result = normalizeSimilaritiesWithTagged(input);

    // Same length
    expect(result).toHaveLength(4);

    // Extract by keyword
    const tsArticles = result.filter((a) => a.keyword === "TypeScript");
    const rustArticles = result.filter((a) => a.keyword === "Rust");

    // Each group's similarity sums to SOFTMAX_SCALE (approximately)
    const tsSum = tsArticles.reduce((s, a) => s + a.similarity, 0);
    const rustSum = rustArticles.reduce((s, a) => s + a.similarity, 0);
    expect(tsSum).toBeCloseTo(SOFTMAX_SCALE, 1);
    expect(rustSum).toBeCloseTo(SOFTMAX_SCALE, 1);

    // Higher raw similarity gets higher normalized similarity within group
    expect(tsArticles[0].similarity).toBeGreaterThan(tsArticles[1].similarity);
    expect(rustArticles[0].similarity).toBeGreaterThan(rustArticles[1].similarity);
  });

  test("keyword=null の記事はスキップされる", () => {
    const input = [
      makeTagged("TypeScript", 0.9, "ts1"),
      makeTagged(null, 0.8, "untagged"), // ← skipped
      makeTagged("TypeScript", 0.3, "ts2"),
    ];

    const result = normalizeSimilaritiesWithTagged(input);

    // The untagged article should pass through with unchanged similarity
    const untagged = result.find((a) => a.article.title === "untagged")!;
    expect(untagged.similarity).toBe(0.8);

    // The TypeScript group should still normalize
    const tsArticles = result.filter((a) => a.keyword === "TypeScript");
    const tsSum = tsArticles.reduce((s, a) => s + a.similarity, 0);
    expect(tsSum).toBeCloseTo(SOFTMAX_SCALE, 1);
  });

  test("空配列 → 空配列", () => {
    expect(normalizeSimilaritiesWithTagged([])).toEqual([]);
  });

  test("単一キーワード単一記事 → similarity = SOFTMAX_SCALE", () => {
    const input = [makeTagged("TypeScript", 0.7)];
    const result = normalizeSimilaritiesWithTagged(input);
    expect(result[0].similarity).toBeCloseTo(SOFTMAX_SCALE, 5);
  });
});
