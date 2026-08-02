import type { ArticleWithTag } from "@/lib/types";
import {
  RECENCY_TIERS,
  SOFTMAX_SCALE,
  WEIGHT_SIMILARITY,
  WEIGHT_USEFULNESS,
  WEIGHT_RECENCY,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
} from "./constants";

/**
 * Algorithmic recency score (0-10) based on publishedAt freshness.
 * Used by fetch-news to calculate article scores.
 */
export function calcRecencyScore(publishedAt: string): number {
  const now = Date.now();
  const pub = new Date(publishedAt).getTime();
  const days =
    (now - pub) / (MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY);
  for (const tier of RECENCY_TIERS) {
    if (days <= tier.days) return tier.score;
  }
  return 0;
}

/**
 * Composite score: similarity (20%) + usefulness (50%) + recency (30%).
 * Returns null if usefulness is missing.
 */
export function calcCompositeScore(
  similarity: number,
  usefulness: number | null,
  recency: number,
): number | null {
  if (usefulness === null) return null;
  // similarity is already normalized to 0-10 by normalizeSimilaritiesWithTagged
  const normalizedSimilarity = Math.max(0, Math.min(SOFTMAX_SCALE, similarity));
  return (
    Math.round(
      (normalizedSimilarity * WEIGHT_SIMILARITY +
        usefulness * WEIGHT_USEFULNESS +
        recency * WEIGHT_RECENCY) *
        SOFTMAX_SCALE,
    ) / SOFTMAX_SCALE
  );
}

export function softmax(values: number[], temperature = 1.0): number[] {
  const max = Math.max(...values);
  const exponents = values.map((v) => Math.exp((v - max) / temperature));
  const sum = exponents.reduce((a, b) => a + b, 0);
  return exponents.map((e) => e / sum);
}

export function normalizeSimilaritiesWithTagged(tagged: ArticleWithTag[]): ArticleWithTag[] {
  const byKeyword = new Map<string, ArticleWithTag[]>();
  for (const t of tagged) {
    if (t.keyword === null) continue; // Skip untagged articles
    const list = byKeyword.get(t.keyword) || [];
    list.push(t);
    byKeyword.set(t.keyword, list);
  }

  const normalizedByRef = new Map<ArticleWithTag, number>();
  for (const [, group] of byKeyword) {
    const similarities = group.map((t) => t.similarity);
    const normalized = softmax(similarities);
    group.forEach((t, i) => normalizedByRef.set(t, normalized[i] * SOFTMAX_SCALE));
  }

  return tagged.map((t) =>
    normalizedByRef.has(t) ? { ...t, similarity: normalizedByRef.get(t)! } : t,
  );
}
