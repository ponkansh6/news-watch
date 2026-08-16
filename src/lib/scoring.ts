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
 * Composite score: relevance (10%) + usefulness (60%) + recency (30%).
 * Returns null if usefulness is missing.
 */
export function calcCompositeScore(
  relevance: number,
  usefulness: number | null,
  recency: number,
): number | null {
  if (usefulness === null) return null;
  const normalizedRelevance = Math.max(0, Math.min(SOFTMAX_SCALE, relevance));
  return (
    Math.round(
      (normalizedRelevance * WEIGHT_SIMILARITY +
        usefulness * WEIGHT_USEFULNESS +
        recency * WEIGHT_RECENCY) *
        SOFTMAX_SCALE,
    ) / SOFTMAX_SCALE
  );
}
