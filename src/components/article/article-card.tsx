"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ScorePopover } from "./score-popover";
import { scoreTier } from "@/lib/ui/score";
import { HelpCircle } from "lucide-react";

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
      year: "numeric",
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
    <li>
      <Card className="group transition-colors hover:shadow-sm">
        <article className="flex gap-3 p-3 sm:gap-4 sm:p-4 h-full">
          {/* Left: Score with tier bar */}
          <div className="shrink-0 flex flex-col items-center gap-1.5 sm:gap-2">
            <div className={`w-1 h-10 sm:h-12 rounded-full ${barColor}`} />
            <ScorePopover
              score={score ?? null}
              relevance={relevance ?? null}
              usefulness={usefulness ?? null}
              recency={recency ?? null}
            />
          </div>

          {/* Right: Content */}
          <div className="min-w-0 flex-1 flex flex-col">
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
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                  {summary}
                </p>
              )}
            </div>

            {/* Separator */}
            <Separator className="my-3" />

            {/* Metadata: Source · Date · Keyword · Reason */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {displaySource && (
                <span className="font-medium text-muted-foreground">{displaySource}</span>
              )}
              <span className="text-muted-foreground">·</span>
              <time dateTime={publishedAt} className="text-muted-foreground">
                {formatDate(publishedAt)}
              </time>
              {keywordLabel && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <Badge variant="secondary">{keywordLabel}</Badge>
                </>
              )}
              {reason && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`スコアの理由: ${reason}`}
                      >
                        <HelpCircle className="h-3 w-3" />
                        <span className="italic truncate max-w-[8rem] sm:max-w-[12rem]">
                          {reason}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 text-sm leading-relaxed">
                      {reason}
                    </PopoverContent>
                  </Popover>
                </>
              )}
            </div>
          </div>
        </article>
      </Card>
    </li>
  );
}

export default ArticleCard;
