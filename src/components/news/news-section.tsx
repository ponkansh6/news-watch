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
    <div className="space-y-3">
      <div className="mb-2 flex items-center justify-between sm:mb-4">
        <h1 className="text-xl font-semibold">
          スコアリング済み記事
          <span
            className="ml-2 text-sm font-normal text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {headerSuffix}
          </span>
          {isFiltering && !isRefreshing && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-primary"
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
        <Card className="p-12 text-center">
          <Newspaper className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">まだ記事がありません</h3>
          <p className="text-sm text-muted-foreground mt-2">
            {emptyMessage || "「ニュースを取得」ボタンで最新ニュースを取得・スコアリングできます"}
          </p>
        </Card>
      ) : (
        <ArticleList articles={articles} isLoading={isRefreshing} />
      )}
    </div>
  );
}

export default NewsSection;
