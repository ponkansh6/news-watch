import { describe, it, expect } from "vitest";
import { scoreTier, SCORE_TIER_LABEL } from "@/lib/ui/score";

describe("scoreTier", () => {
  it("returns 'none' for null", () => {
    expect(scoreTier(null)).toBe("none");
  });

  it("returns 'low' for scores below 5", () => {
    expect(scoreTier(0)).toBe("low");
    expect(scoreTier(4.9)).toBe("low");
  });

  it("returns 'mid' for scores between 5 and 7.9", () => {
    expect(scoreTier(5)).toBe("mid");
    expect(scoreTier(6.5)).toBe("mid");
    expect(scoreTier(7.9)).toBe("mid");
  });

  it("returns 'high' for scores 8 and above", () => {
    expect(scoreTier(8)).toBe("high");
    expect(scoreTier(9.5)).toBe("high");
    expect(scoreTier(10)).toBe("high");
  });
});

describe("SCORE_TIER_LABEL", () => {
  it("has correct labels for each tier", () => {
    expect(SCORE_TIER_LABEL.high).toBe("高スコア");
    expect(SCORE_TIER_LABEL.mid).toBe("中スコア");
    expect(SCORE_TIER_LABEL.low).toBe("低スコア");
    expect(SCORE_TIER_LABEL.none).toBe("未スコア");
  });
});
