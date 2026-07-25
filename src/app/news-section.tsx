"use client";

import { useEffect, useRef } from "react";
import { useRefresh } from "./refresh-context";
import ArticleList, { SkeletonList } from "./article-list";

export default function NewsSection({
  articles,
  emptyMessage,
}: {
  articles: import("./article-list").Article[];
  emptyMessage?: string;
}) {
  const { isRefreshing, setRefreshing } = useRefresh();
  const prevIdsRef = useRef<Set<number>>(new Set(articles.map((a) => a.id)));

  // Detect when NEW scored articles arrive after refresh and clear refreshing.
  // Uses article ID comparison instead of reference equality to avoid
  // premature clearing on RSC re-renders that return the same data.
  useEffect(() => {
    if (isRefreshing) {
      const currentIds = new Set(articles.map((a) => a.id));
      const hasNewIds = [...currentIds].some((id) => !prevIdsRef.current.has(id));
      if (hasNewIds) {
        setRefreshing(false);
      }
      prevIdsRef.current = currentIds;
    }
  }, [articles, isRefreshing, setRefreshing]);

  if (isRefreshing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            スコアリング済み記事
            <span className="ml-2 text-sm font-normal text-neutral-400">(更新中...)</span>
          </h2>
        </div>
        <SkeletonList count={5} />
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            スコアリング済み記事
            <span className="ml-2 text-sm font-normal text-neutral-400">(0件)</span>
          </h2>
        </div>
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center text-neutral-400">
          <p className="mb-2 text-lg">まだ記事がありません</p>
          <p className="text-sm">
            {emptyMessage || "「ニュースを取得」ボタンで最新ニュースを取得・スコアリングできます"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          スコアリング済み記事
          <span className="ml-2 text-sm font-normal text-neutral-400">({articles.length}件)</span>
        </h2>
      </div>
      <ArticleList articles={articles} />
    </div>
  );
}
