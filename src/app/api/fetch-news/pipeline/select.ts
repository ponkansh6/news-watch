import { SCORING_BUDGET } from "@/lib/constants";
import { getScoringStateByUrls } from "@/lib/db";
import { computeContentHash } from "@/lib/scoring-signature";
import type { NormalizedArticle } from "@/lib/types";

export interface SelectionResult {
  toScore: NormalizedArticle[]; // LLM に投げる
  skipped: NormalizedArticle[]; // 既スコア＆内容不変 → recency のみ
  deferred: NormalizedArticle[]; // 未スコアだが予算超過 → 次回
}

export async function selectForScoring(
  articles: NormalizedArticle[],
  signature: string,
  budget = SCORING_BUDGET,
): Promise<SelectionResult> {
  const stateByUrl = await getScoringStateByUrls(articles.map((a) => a.url));

  const skipped: NormalizedArticle[] = [];
  const candidates: NormalizedArticle[] = [];

  for (const a of articles) {
    const state = stateByUrl.get(a.url);
    const isSkippable =
      state?.scoredAt !== null &&
      state?.scoredAt !== undefined &&
      (state.contentHash === null ||
        state.contentHash === computeContentHash(a.title, a.description)) &&
      (state.scoringSignature === null || state.scoringSignature === signature);
    // 注意: 両列 null（既存行・移行時）は「一致」扱いで skip にする
    if (isSkippable) skipped.push(a);
    else candidates.push(a);
  }

  const sorted = [...candidates].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return {
    toScore: sorted.slice(0, budget),
    skipped,
    deferred: sorted.slice(budget),
  };
}
