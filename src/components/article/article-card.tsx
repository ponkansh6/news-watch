"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScorePopover } from "./score-popover";
import { scoreTier } from "@/lib/ui/score";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArticleCardProps {
  id: string | number;
  title: string;
  url: string;
  sourceName?: string | null;
  sourceId?: string | null;
  source?: string;
  publishedAt: string;
  summary?: string | null;
  score?: number | null;
  relevance?: number | null;
  usefulness?: number | null;
  recency?: number | null;
  keywordLabel?: string | null;
  reason?: string | null;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onPointerDown?: React.PointerEventHandler<HTMLElement>;
  swipeGesture?: {
    onPointerDown: React.PointerEventHandler<HTMLElement>;
    onPointerUp: React.PointerEventHandler<HTMLElement>;
    onPointerCancel: React.PointerEventHandler<HTMLElement>;
    onClickCapture: React.MouseEventHandler<HTMLElement>;
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ArticleCard({
  title,
  url,
  sourceName,
  sourceId,
  source,
  publishedAt,
  summary,
  score,
  relevance,
  usefulness,
  recency,
  keywordLabel,
  reason,
  onPointerDown,
  swipeGesture,
}: ArticleCardProps) {
  const displaySource = sourceName ?? sourceId ?? source ?? "source";
  const tier = scoreTier(score ?? null);
  const barColor =
    tier === "high"
      ? "bg-score-high"
      : tier === "mid"
        ? "bg-score-mid"
        : tier === "low"
          ? "bg-score-low"
          : "bg-muted";

  return (
    <li className="group/article relative bg-card transition-colors sm:border sm:border-border sm:shadow-[0_1px_0_rgb(15_23_42/0.03)] sm:hover:border-primary/35 dark:sm:shadow-none">
      <span aria-hidden className={cn("absolute inset-y-4 left-0 w-0.5 sm:inset-y-0", barColor)} />
      <article className="px-4 py-4 sm:px-5 sm:py-5">
        {/* Title + Summary */}
        <div>
          <h3 className="select-none touch-pan-y py-1 -my-1" {...swipeGesture}>
            <a
              draggable={false}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[1.02rem] font-semibold leading-[1.55] tracking-[-0.015em] text-foreground transition-colors hover:text-primary line-clamp-3 sm:text-[1.08rem]"
            >
              {title}
            </a>
          </h3>
          {summary && (
            <p
              className="mt-2 select-none touch-manipulation text-[0.88rem] leading-[1.8] text-muted-foreground line-clamp-3"
              onPointerDown={onPointerDown}
            >
              {summary}
            </p>
          )}
        </div>

        {/* Metadata: Score · Source · MM/DD · Keyword Badge · Reason */}
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/70 pt-2.5 text-xs">
          <ScorePopover
            score={score ?? null}
            relevance={relevance ?? null}
            usefulness={usefulness ?? null}
            recency={recency ?? null}
          />
          <span className="text-border shrink-0">/</span>
          {displaySource && (
            <span
              className="font-medium text-muted-foreground shrink-0 select-none touch-manipulation cursor-pointer"
              onPointerDown={onPointerDown}
            >
              {displaySource}
            </span>
          )}
          <span className="text-border shrink-0">/</span>
          <time
            dateTime={publishedAt}
            title={publishedAt}
            className="text-muted-foreground shrink-0 select-none touch-manipulation cursor-pointer"
            onPointerDown={onPointerDown}
          >
            {formatDate(publishedAt)}
          </time>
          {keywordLabel && (
            <>
              <span className="text-border shrink-0">/</span>
              <Badge variant="secondary" className="shrink-0 max-w-[6rem] truncate">
                {keywordLabel}
              </Badge>
            </>
          )}
          {reason && (
            <>
              <span className="text-border shrink-0">/</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-w-0 flex-1 items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`スコアの理由: ${reason}`}
                  >
                    <HelpCircle className="h-3 w-3 shrink-0" />
                    <span className="italic truncate">{reason}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm leading-relaxed">{reason}</PopoverContent>
              </Popover>
            </>
          )}
        </div>
      </article>
    </li>
  );
}

export default ArticleCard;
