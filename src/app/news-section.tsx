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
  const prevArticlesRef = useRef(articles);

  // Detect when articles prop changes after refresh and clear refreshing
  useEffect(() => {
    if (isRefreshing) {
      // Only clear if articles reference actually changed (refresh completed)
      if (prevArticlesRef.current !== articles) {
        setRefreshing(false);
      }
      prevArticlesRef.current = articles;
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
