"use client";

import { Newspaper } from "lucide-react";
import { useRefresh } from "@/app/refresh-context";
import { ArticleList, type Article } from "@/components/article/article-list";
import { Card } from "@/components/ui/card";

export function NewsSection({
  articles,
  emptyMessage,
}: {
  articles: Article[];
  emptyMessage?: string;
}) {
  const { isRefreshing, isFiltering } = useRefresh();

  const headerSuffix = isRefreshing ? "(更新中...)" : `(${articles.length}件)`;

  return (
    <section className="space-y-4" aria-labelledby="scored-news-heading">
      <div className="flex items-end justify-between border-b border-border pb-3">
        <h1 id="scored-news-heading" className="text-lg font-semibold tracking-tight sm:text-xl">
          スコアリング済み記事
          <span
            className="ml-2 text-xs font-normal tabular-nums text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {headerSuffix}
          </span>
          {isFiltering && !isRefreshing && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-primary"
              role="status"
              aria-live="polite"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              フィルタリング中...
            </span>
          )}
        </h1>
      </div>

      {articles.length === 0 ? (
        <Card className="border-dashed p-10 text-center sm:p-14">
          <Newspaper className="mx-auto mb-4 h-9 w-9 text-primary/60" strokeWidth={1.4} />
          <h3 className="text-lg font-semibold">まだ記事がありません</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {emptyMessage || "「ニュースを取得」ボタンで最新ニュースを取得・スコアリングできます"}
          </p>
        </Card>
      ) : (
        <ArticleList articles={articles} isLoading={isRefreshing} />
      )}
    </section>
  );
}

export default NewsSection;
