export type ScoreTier = "high" | "mid" | "low" | "none";

const HIGH_SCORE_THRESHOLD = 8;
const MID_SCORE_THRESHOLD = 5;

export function scoreTier(score: number | null): ScoreTier {
  if (score === null) return "none";
  if (score >= HIGH_SCORE_THRESHOLD) return "high";
  if (score >= MID_SCORE_THRESHOLD) return "mid";
  return "low";
}

export const SCORE_TIER_LABEL: Record<ScoreTier, string> = {
  high: "高スコア",
  mid: "中スコア",
  low: "低スコア",
  none: "未スコア",
};
