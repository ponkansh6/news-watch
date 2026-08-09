"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
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
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
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
    <li className="relative bg-card transition-colors sm:overflow-hidden sm:rounded-xl sm:ring-1 sm:ring-foreground/10 sm:hover:shadow-sm">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", barColor)} />
      <article className="px-3 py-3 sm:px-4 sm:py-3.5">
        {/* Title + Summary */}
        <div className="select-none touch-manipulation" onPointerDown={onPointerDown}>
          <h3>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-semibold leading-snug text-foreground transition-colors hover:text-primary text-base line-clamp-2"
            >
              {title}
            </a>
          </h3>
          {summary && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
              {summary}
            </p>
          )}
        </div>

        {/* Separator */}
        <Separator className="my-2" />

        {/* Metadata: Score · Source · MM/DD · Keyword Badge · Reason */}
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <ScorePopover
            score={score ?? null}
            relevance={relevance ?? null}
            usefulness={usefulness ?? null}
            recency={recency ?? null}
          />
          <span className="text-muted-foreground shrink-0">·</span>
          {displaySource && (
            <span className="font-medium text-muted-foreground shrink-0">{displaySource}</span>
          )}
          <span className="text-muted-foreground shrink-0">·</span>
          <time
            dateTime={publishedAt}
            title={publishedAt}
            className="text-muted-foreground shrink-0"
          >
            {formatDate(publishedAt)}
          </time>
          {keywordLabel && (
            <>
              <span className="text-muted-foreground shrink-0">·</span>
              <Badge variant="secondary" className="shrink-0 max-w-[6rem] truncate">
                {keywordLabel}
              </Badge>
            </>
          )}
          {reason && (
            <>
              <span className="text-muted-foreground shrink-0">·</span>
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
