/**
 * Algorithmic recency score (0-10) based on publishedAt freshness.
 * Used by fetch-news to calculate article scores.
 */
export function calcRecencyScore(publishedAt: string): number {
  const now = Date.now();
  const pub = new Date(publishedAt).getTime();
  const days = (now - pub) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  if (days <= 30) return 2;
  return 0;
}

/**
 * Composite score: similarity (30%) + usefulness (40%) + recency (30%).
 * Returns null if usefulness is missing.
 */
export function calcCompositeScore(
  similarity: number,
  usefulness: number | null,
  recency: number,
): number | null {
  if (usefulness === null) return null;
  const normalizedSimilarity = Math.max(0, Math.min(1, similarity)) * 10;
  return Math.round((normalizedSimilarity * 0.3 + usefulness * 0.4 + recency * 0.3) * 10) / 10;
}
