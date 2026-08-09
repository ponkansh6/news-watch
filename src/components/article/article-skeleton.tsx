import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonCard() {
  return (
    <article className="px-3 py-4 sm:px-4 sm:py-3.5">
      <div className="space-y-2">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </article>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <ul
      role="list"
      className="-mx-4 divide-y-8 divide-muted sm:mx-0 sm:divide-y-0 sm:space-y-3"
      aria-label="記事を読み込み中"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} role="status">
          <SkeletonCard />
        </li>
      ))}
    </ul>
  );
}
