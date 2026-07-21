import type { ArticleWithTag } from "@/lib/types";

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
  // similarity is already normalized to 0-10 by normalizeSimilaritiesWithTagged
  const normalizedSimilarity = Math.max(0, Math.min(10, similarity));
  return Math.round((normalizedSimilarity * 0.3 + usefulness * 0.4 + recency * 0.3) * 10) / 10;
}

export function softmax(values: number[], temperature = 1.0): number[] {
  const exponents = values.map((v) => Math.exp(v / temperature));
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

  for (const [_, group] of byKeyword) {
    const similarities = group.map((t) => t.similarity);
    const normalized = softmax(similarities);
    for (let i = 0; i < group.length; i++) {
      group[i].similarity = normalized[i] * 10;
    }
  }
  return tagged;
}
