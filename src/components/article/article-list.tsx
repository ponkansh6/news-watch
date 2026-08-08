"use client";

import { useState, useEffect, useRef } from "react";
import type { ArticleListRow } from "@/lib/db/query/article-queries";
import { ArticleCard } from "./article-card";
import { SkeletonList } from "./article-skeleton";

export type Article = ArticleListRow;
export type { ArticleListRow };

interface ArticleListProps {
  articles: Article[];
  isLoading?: boolean;
}

export function ArticleList({ articles, isLoading }: ArticleListProps) {
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const clickCountsRef = useRef<
    Record<number, { count: number; timer: ReturnType<typeof setTimeout> | null }>
  >({});

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleTap = (articleId: number) => {
    const record = clickCountsRef.current[articleId] || { count: 0, timer: null };

    if (record.timer) {
      clearTimeout(record.timer);
    }

    record.count += 1;

    if (record.count >= 5) {
      record.count = 0;
      toggleFav(articleId);
    } else {
      record.timer = setTimeout(() => {
        record.count = 0;
      }, 4000);
    }

    clickCountsRef.current[articleId] = record;
  };

  const toggleFav = (articleId: number) => {
    fetch("/api/favorites/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`お気に入りの更新に失敗しました (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data && typeof data.favorited === "boolean") {
          setMessage({
            text: data.favorited ? "お気に入りに登録しました" : "お気に入りを解除しました",
            type: "success",
          });
        } else {
          throw new Error("サーバーからの応答が不正です");
        }
      })
      .catch((err) => {
        console.error("Failed to toggle favorite:", err);
        setMessage({
          text: err instanceof Error ? err.message : "お気に入りの更新に失敗しました",
          type: "error",
        });
      });
  };

  return (
    <>
      {message && (
        <div
          className={`fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            message.type === "success"
              ? "border-score-high/20 bg-score-high/10 text-score-high"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className={`shrink-0 font-bold ${
              message.type === "success"
                ? "text-score-high hover:text-score-high"
                : "text-destructive hover:text-destructive"
            }`}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
      )}
      <ul
        role="list"
        className={`space-y-3 ${isLoading ? "opacity-60 pointer-events-none" : ""}`}
        aria-busy={isLoading}
      >
        {articles.map((article) => (
          <ArticleCard key={article.id} {...article} onPointerDown={() => handleTap(article.id)} />
        ))}
      </ul>
    </>
  );
}

export default ArticleList;
export { SkeletonList };
