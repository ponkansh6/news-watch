"use client";

import { useState, useEffect, useRef } from "react";
import type { ArticleListRow } from "@/lib/db/query/article-queries";
import { ArticleCard } from "./article-card";
import { SkeletonList } from "./article-skeleton";
import {
  FAVORITE_TAP_COUNT,
  FAVORITE_TAP_TIMEOUT_MS,
  NFM_SWIPE_COUNT,
  NFM_SWIPE_TIMEOUT_MS,
  NFM_SWIPE_THRESHOLD_PX,
} from "@/lib/constants";

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
  const swipeCountsRef = useRef<
    Record<number, { count: number; timer: ReturnType<typeof setTimeout> | null }>
  >({});
  const swipeStartRef = useRef<Record<number, { x: number; y: number }>>({});
  const swipeSuppressClickRef = useRef<Record<number, boolean>>({});

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

    if (record.count >= FAVORITE_TAP_COUNT) {
      record.count = 0;
      toggleFav(articleId);
    } else {
      record.timer = setTimeout(() => {
        record.count = 0;
      }, FAVORITE_TAP_TIMEOUT_MS);
    }

    clickCountsRef.current[articleId] = record;
  };

  const handleSwipeStart = (articleId: number, e: React.PointerEvent<HTMLElement>) => {
    swipeStartRef.current[articleId] = { x: e.clientX, y: e.clientY };
    swipeSuppressClickRef.current[articleId] = false;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore if pointer capture fails/unsupported
    }
  };

  const handleSwipeEnd = (articleId: number, e: React.PointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current[articleId];
    delete swipeStartRef.current[articleId];
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (Math.abs(dx) >= NFM_SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      swipeSuppressClickRef.current[articleId] = true;

      const record = swipeCountsRef.current[articleId] || { count: 0, timer: null };

      if (record.timer) {
        clearTimeout(record.timer);
      }

      record.count += 1;

      if (record.count >= NFM_SWIPE_COUNT) {
        record.count = 0;
        toggleNotForMe(articleId);
      } else {
        record.timer = setTimeout(() => {
          record.count = 0;
        }, NFM_SWIPE_TIMEOUT_MS);
      }

      swipeCountsRef.current[articleId] = record;
    }
  };

  const handleSwipeCancel = (articleId: number) => {
    delete swipeStartRef.current[articleId];
  };

  const handleSwipeClickCapture = (articleId: number, e: React.MouseEvent<HTMLElement>) => {
    if (swipeSuppressClickRef.current[articleId]) {
      e.preventDefault();
      e.stopPropagation();
      delete swipeSuppressClickRef.current[articleId];
    }
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

  const toggleNotForMe = (articleId: number) => {
    fetch("/api/not-for-me/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`NFM の更新に失敗しました (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data && typeof data.notForMe === "boolean") {
          setMessage({
            text: data.notForMe ? "NFM に登録しました" : "NFM を解除しました",
            type: "success",
          });
        } else {
          throw new Error("サーバーからの応答が不正です");
        }
      })
      .catch((err) => {
        console.error("Failed to toggle NFM:", err);
        setMessage({
          text: err instanceof Error ? err.message : "NFM の更新に失敗しました",
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
        className={`-mx-4 divide-y-8 divide-muted sm:mx-0 sm:divide-y-0 sm:space-y-3 ${isLoading ? "opacity-60 pointer-events-none" : ""}`}
        aria-busy={isLoading}
      >
        {articles.map((article) => (
          <ArticleCard
            key={article.id}
            {...article}
            onPointerDown={() => handleTap(Number(article.id))}
            swipeGesture={{
              onPointerDown: (e) => handleSwipeStart(Number(article.id), e),
              onPointerUp: (e) => handleSwipeEnd(Number(article.id), e),
              onPointerCancel: () => handleSwipeCancel(Number(article.id)),
              onClickCapture: (e) => handleSwipeClickCapture(Number(article.id), e),
            }}
          />
        ))}
      </ul>
    </>
  );
}

export default ArticleList;
export { SkeletonList };
