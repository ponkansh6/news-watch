import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { RECENCY_TIERS } from "@/lib/constants";

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

  const edgeCases: { label: string; daysAgo: number; expected: number }[] = [
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
  // Weights: relevance=0.1, usefulness=0.6, recency=0.3
  // Formula: round((rel*0.1 + use*0.6 + rec*0.3) * 10) / 10

  test("正常計算: (rel=5, use=8, rec=10) → (5*0.1 + 8*0.6 + 10*0.3) = 0.5 + 4.8 + 3.0 = 8.3", () => {
    expect(calcCompositeScore(5, 8, 10)).toBe(8.3);
  });

  test("usefulness=null → null を返す", () => {
    expect(calcCompositeScore(5, null, 10)).toBeNull();
  });

  test("relevance が負値 → 0 にクランプ", () => {
    // -1 → 0: (0*0.1 + 8*0.6 + 10*0.3) = 0 + 4.8 + 3.0 = 7.8
    expect(calcCompositeScore(-1, 8, 10)).toBe(7.8);
  });

  test("relevance が 10超 → 10 にクランプ", () => {
    // 15 → 10: (10*0.1 + 8*0.6 + 10*0.3) = 1.0 + 4.8 + 3.0 = 8.8
    expect(calcCompositeScore(15, 8, 10)).toBe(8.8);
  });

  test("全て最小値: (rel=0, use=0, rec=0) → 0.0", () => {
    expect(calcCompositeScore(0, 0, 0)).toBe(0.0);
  });

  test("全て最大値: (rel=10, use=10, rec=10) → 10.0", () => {
    expect(calcCompositeScore(10, 10, 10)).toBe(10.0);
  });
});
