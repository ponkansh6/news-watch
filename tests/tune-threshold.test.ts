/**
 * Tests for the threshold tuning evaluation logic in src/lib/threshold-eval.ts
 * and an end-to-end check over the labeled fixture dataset.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateThreshold,
  sweepThresholds,
  recommendThreshold,
  hashEmbed,
  type LabeledSample,
  type ScoredArticle,
} from "@/lib/threshold-eval";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

function lexicalSimilarity(query: string, doc: string): number {
  const q = tokenize(query);
  const d = new Set(tokenize(doc));
  if (q.length === 0) return 0;
  return q.filter((t) => d.has(t)).length / q.length;
}

describe("evaluateThreshold", () => {
  const scored: ScoredArticle[] = [
    { similarity: 0.9, relevant: true },
    { similarity: 0.8, relevant: true },
    { similarity: 0.6, relevant: false },
    { similarity: 0.4, relevant: false },
  ];

  test("perfect separation at 0.7", () => {
    const r = evaluateThreshold(scored, 0.7);
    expect(r).toMatchObject({ tp: 2, fp: 0, fn: 0, tn: 2, precision: 1, recall: 1, f1: 1 });
  });

  test("one false negative at 0.85", () => {
    const r = evaluateThreshold(scored, 0.85);
    expect(r.tp).toBe(1);
    expect(r.fn).toBe(1);
    expect(r.fp).toBe(0);
    expect(r.tn).toBe(2);
    expect(r.precision).toBe(1);
    expect(r.recall).toBeCloseTo(0.5);
    expect(r.f1).toBeCloseTo(2 / 3);
  });

  test("zero division yields 0 metrics", () => {
    const r = evaluateThreshold([], 0.5);
    expect(r).toMatchObject({ tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0, f1: 0 });
  });
});

describe("sweepThresholds", () => {
  const scored: ScoredArticle[] = [
    { similarity: 0.9, relevant: true },
    { similarity: 0.3, relevant: false },
  ];

  test("returns one result per threshold", () => {
    const results = sweepThresholds(scored, [0.5, 0.6, 0.7]);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.threshold)).toEqual([0.5, 0.6, 0.7]);
  });
});

describe("recommendThreshold", () => {
  const results = [
    { threshold: 0.4, tp: 1, fp: 0, fn: 0, tn: 1, precision: 1, recall: 1, f1: 1 },
    { threshold: 0.5, tp: 1, fp: 0, fn: 0, tn: 1, precision: 1, recall: 1, f1: 1 },
    { threshold: 0.6, tp: 1, fp: 0, fn: 0, tn: 1, precision: 1, recall: 1, f1: 1 },
    { threshold: 0.7, tp: 1, fp: 0, fn: 1, tn: 1, precision: 1, recall: 0.5, f1: 2 / 3 },
    { threshold: 0.8, tp: 1, fp: 0, fn: 1, tn: 1, precision: 1, recall: 0.5, f1: 2 / 3 },
    { threshold: 0.9, tp: 0, fp: 0, fn: 1, tn: 1, precision: 0, recall: 0, f1: 0 },
  ];

  test("picks smallest threshold on f1 tie", () => {
    const rec = recommendThreshold(results, 0.85);
    expect(rec.maxF1Threshold).toBe(0.4);
    expect(rec.maxF1).toBe(1);
  });

  test("recall-target threshold is the smallest satisfying recall>=target", () => {
    const rec = recommendThreshold(results, 0.85);
    expect(rec.recallTargetThreshold).toBe(0.4);
  });

  test("null when no threshold meets recall target", () => {
    const lowRecall = results.map((r) => ({ ...r, recall: 0.5, f1: 0.6 }));
    const rec = recommendThreshold(lowRecall, 0.85);
    expect(rec.recallTargetThreshold).toBeNull();
  });
});

describe("hashEmbed", () => {
  test("deterministic for same input", () => {
    expect(hashEmbed("AI model release")).toEqual(hashEmbed("AI model release"));
  });

  test("fixed dimension and normalized", () => {
    const v = hashEmbed("some text here");
    expect(v).toHaveLength(256);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test("related text scores higher than unrelated", () => {
    const q = hashEmbed("AI model release");
    const related = hashEmbed("new AI model beats benchmark");
    const unrelated = hashEmbed("local sports results");
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated));
  });
});

describe("end-to-end over fixture dataset (offline lexical proxy)", () => {
  const datasetPath = resolve(process.cwd(), "scripts/fixtures/threshold-dataset.json");
  const samples: LabeledSample[] = JSON.parse(readFileSync(datasetPath, "utf-8"));

  function buildScored(): ScoredArticle[] {
    const out: ScoredArticle[] = [];
    for (const s of samples) {
      for (const a of s.articles) {
        out.push({
          similarity: lexicalSimilarity(s.keyword, `${a.title} ${a.description ?? ""}`),
          relevant: a.relevant,
        });
      }
    }
    return out;
  }

  test("recommendation is consistent and achieves decent recall", () => {
    const scored = buildScored();
    const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
    const results = sweepThresholds(scored, thresholds);
    const rec = recommendThreshold(results, 0.85);

    // recall-target threshold should never exceed the max-F1 threshold
    if (rec.recallTargetThreshold !== null) {
      expect(rec.recallTargetThreshold).toBeLessThanOrEqual(rec.maxF1Threshold);
    }

    // At the recommended (max-F1) threshold, pooled recall should be reasonable
    const chosen = results.find((r) => r.threshold === rec.maxF1Threshold)!;
    expect(chosen.recall).toBeGreaterThanOrEqual(0.5);
  });
});

describe("end-to-end script with --json flag", () => {
  test("runs with --offline --json and returns valid JSON", () => {
    const { execSync } = require("child_process");
    const output = execSync("pnpm exec tsx scripts/tune-threshold.ts --offline --json", {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 30000,
    });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("recommendation");
    expect(parsed).toHaveProperty("selectedThreshold");
    expect(parsed).toHaveProperty("envEntry");
    expect(parsed.envEntry).toMatch(/^SIMILARITY_THRESHOLD=/);
  });
});
