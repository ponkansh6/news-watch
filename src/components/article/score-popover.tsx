"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scoreTier, SCORE_TIER_LABEL } from "@/lib/ui/score";
import { cn } from "@/lib/utils";

interface ScorePopoverProps {
  score: number | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
}

export function ScoreBreakdown({ score, relevance, usefulness, recency }: ScorePopoverProps) {
  const tier = scoreTier(score);

  const formatValue = (val: number | null) => (val !== null ? val.toFixed(1) : "N/A");
  const formatBar = (val: number | null) => {
    if (val === null) return "░░░░░░░░░░";
    const filledCount = Math.round(Math.max(0, Math.min(10, val)));
    return "█".repeat(filledCount) + "░".repeat(10 - filledCount);
  };

  return (
    <div
      className="flex flex-col gap-2"
      aria-label={
        score !== null ? `スコア ${score.toFixed(1)}、${SCORE_TIER_LABEL[tier]}` : "未スコア"
      }
    >
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 text-xs">
        <span className="text-muted-foreground">関連性 (NTT との関連度)</span>
        <span className="font-mono text-muted-foreground">{formatBar(relevance)}</span>
        <span className="font-mono text-right">{formatValue(relevance)}</span>
        <span className="text-muted-foreground text-right">× 10%</span>

        <span className="text-muted-foreground">有用性</span>
        <span className="font-mono text-muted-foreground">{formatBar(usefulness)}</span>
        <span className="font-mono text-right">{formatValue(usefulness)}</span>
        <span className="text-muted-foreground text-right">× 60%</span>

        <span className="text-muted-foreground">新しさ</span>
        <span className="font-mono text-muted-foreground">{formatBar(recency)}</span>
        <span className="font-mono text-right">{formatValue(recency)}</span>
        <span className="text-muted-foreground text-right">× 30%</span>
      </div>
      <div className="border-t pt-2 flex items-center justify-between font-medium">
        <span>合成</span>
        <span className="font-mono">{score !== null ? score.toFixed(1) : "--"}</span>
      </div>
    </div>
  );
}

export function ScorePopover({ score, relevance, usefulness, recency }: ScorePopoverProps) {
  if (score === null) {
    return (
      <div className="inline-flex shrink-0 items-center rounded px-1 text-xs text-muted-foreground">
        --
      </div>
    );
  }

  const tier = scoreTier(score);
  const textColorClass =
    tier === "high"
      ? "text-score-high"
      : tier === "mid"
        ? "text-score-mid"
        : tier === "low"
          ? "text-score-low"
          : "text-muted-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`スコア ${score}、${SCORE_TIER_LABEL[tier]}。内訳を表示します`}
          className={cn(
            "inline-flex shrink-0 items-center rounded px-1 font-mono text-xs tabular-nums font-semibold transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            textColorClass,
          )}
        >
          {score.toFixed(1)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <ScoreBreakdown
          score={score}
          relevance={relevance}
          usefulness={usefulness}
          recency={recency}
        />
      </PopoverContent>
    </Popover>
  );
}

export default ScorePopover;
