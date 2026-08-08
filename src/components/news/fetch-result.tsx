"use client";

import { useState } from "react";

interface FetchResultData {
  keyword: string;
  fetched: number;
  scored: number;
  processed: number;
  errors: string[];
}

interface FetchResultProps {
  results: FetchResultData[] | null;
  error: string | null;
}

export function FetchResult({ results, error }: FetchResultProps) {
  const [showDetail, setShowDetail] = useState(false);

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/15 px-4 py-2 text-sm text-destructive">{error}</div>
    );
  }

  if (!results) {
    return null;
  }

  const totalScored = results.reduce((a, r) => a + r.scored, 0);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{totalScored}件 スコアリング完了</span>
        <button
          type="button"
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {showDetail ? "閉じる" : "詳細を表示"}
        </button>
      </div>

      {showDetail && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {results.map((r) => (
            <div key={r.keyword} className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground">合計</span>
              <span className="flex items-center gap-1.5">
                {r.errors.length > 0 ? (
                  <span className="text-destructive" title={r.errors.join("; ")}>
                    {r.fetched}件取得 / {r.scored}件スコアリング ⚠
                  </span>
                ) : (
                  <span className="text-score-high">
                    {r.fetched}件取得 / {r.scored}件スコアリング ✅
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
