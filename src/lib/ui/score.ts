export type ScoreTier = "high" | "mid" | "low" | "none";

export function scoreTier(score: number | null): ScoreTier {
  if (score === null) return "none";
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

export const SCORE_TIER_LABEL: Record<ScoreTier, string> = {
  high: "高スコア",
  mid: "中スコア",
  low: "低スコア",
  none: "未スコア",
};
