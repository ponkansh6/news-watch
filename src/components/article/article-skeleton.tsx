import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function SkeletonCard() {
  return (
    <Card>
      <article className="flex gap-4 p-4">
        {/* Left: Score placeholder (bar) */}
        <div className="shrink-0 flex flex-col items-center gap-2">
          <Skeleton className="h-12 w-1 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-lg" />
        </div>
        {/* Right: Content placeholders */}
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </article>
    </Card>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <ul role="list" className="space-y-3" aria-label="記事を読み込み中" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} role="status">
          <SkeletonCard />
        </li>
      ))}
    </ul>
  );
}
