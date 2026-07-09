import { describe, expect, test } from "vitest";
import { renderThresholdEntry, upsertEnvVar, selectThreshold } from "@/lib/threshold-apply";
import type { ThresholdRecommendation } from "@/lib/threshold-eval";

describe("renderThresholdEntry", () => {
  test("formats threshold with two decimal places", () => {
    expect(renderThresholdEntry(0.75)).toBe("SIMILARITY_THRESHOLD=0.75");
    expect(renderThresholdEntry(0.7)).toBe("SIMILARITY_THRESHOLD=0.70");
    expect(renderThresholdEntry(0.5)).toBe("SIMILARITY_THRESHOLD=0.50");
    expect(renderThresholdEntry(1.0)).toBe("SIMILARITY_THRESHOLD=1.00");
  });
});

describe("upsertEnvVar", () => {
  test("replaces existing key", () => {
    const content = "A=1\nSIMILARITY_THRESHOLD=0.50\nB=2";
    const result = upsertEnvVar(content, "SIMILARITY_THRESHOLD", "0.80");
    expect(result).toBe("A=1\nSIMILARITY_THRESHOLD=0.80\nB=2");
  });

  test("adds new key at end (with trailing newline)", () => {
    const content = "A=1\n";
    const result = upsertEnvVar(content, "SIMILARITY_THRESHOLD", "0.75");
    expect(result).toBe("A=1\nSIMILARITY_THRESHOLD=0.75\n");
  });

  test("adds new key at end (without trailing newline)", () => {
    const content = "A=1";
    const result = upsertEnvVar(content, "SIMILARITY_THRESHOLD", "0.75");
    expect(result).toBe("A=1\nSIMILARITY_THRESHOLD=0.75");
  });

  test("does not replace partial matches", () => {
    const content = "SIMILARITY_THRESHOLD_X=1";
    const result = upsertEnvVar(content, "SIMILARITY_THRESHOLD", "0.75");
    expect(result).toBe("SIMILARITY_THRESHOLD_X=1\nSIMILARITY_THRESHOLD=0.75");
  });

  test("preserves comment lines", () => {
    const content = "# comment\nA=1";
    const result = upsertEnvVar(content, "SIMILARITY_THRESHOLD", "0.75");
    expect(result).toBe("# comment\nA=1\nSIMILARITY_THRESHOLD=0.75");
  });
});

describe("selectThreshold", () => {
  const mockRec: ThresholdRecommendation = {
    maxF1Threshold: 0.75,
    maxF1: 0.85,
    recallTargetThreshold: 0.8,
    recallTarget: 0.85,
  };

  test("balanced policy returns maxF1Threshold", () => {
    expect(selectThreshold(mockRec, "balanced")).toBe(0.75);
  });

  test("recall-first policy returns recallTargetThreshold when available", () => {
    expect(selectThreshold(mockRec, "recall-first")).toBe(0.8);
  });

  test("recall-first policy falls back to maxF1Threshold when recallTargetThreshold is null", () => {
    const mockRecNoRecall: ThresholdRecommendation = {
      maxF1Threshold: 0.75,
      maxF1: 0.85,
      recallTargetThreshold: null,
      recallTarget: 0.85,
    };
    expect(selectThreshold(mockRecNoRecall, "recall-first")).toBe(0.75);
  });
});
