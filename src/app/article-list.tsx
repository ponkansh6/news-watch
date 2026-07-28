"use client";

import { useState, useEffect, useRef } from "react";
import { KEYWORD_LABELS } from "@/lib/config";

export interface Article {
  id: number;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string | null;
  author: string | null;
  keyword: string | null;
  summary: string | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
  score: number | null;
  reason: string | null;
  scoredAt: string | null;
  createdAt: string | null;
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

function ScoreBadge({
  score,
  relevance,
  usefulness,
  recency,
}: {
  score: number | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
}) {
  if (score === null) {
    return (
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-bold text-neutral-400">
        --
      </span>
    );
  }

  const color =
    score >= 8
      ? "bg-emerald-100 text-emerald-700"
      : score >= 5
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${color}`}
      title={`関連性: ${relevance?.toFixed(1) || "N/A"} (20%)\n有用性: ${usefulness?.toFixed(1) || "N/A"} (50%)\n新しさ: ${recency?.toFixed(1) || "N/A"} (30%)\n━━━━━━━━━━━━━━━\n合成: ${score.toFixed(1)}`}
    >
      {score}
    </span>
  );
}

function getKeywordColor(keyword: string): string {
  const colors = [
    "bg-rose-50 text-rose-600 border-rose-200",
    "bg-blue-50 text-blue-600 border-blue-200",
    "bg-green-50 text-green-600 border-green-200",
    "bg-purple-50 text-purple-600 border-purple-200",
    "bg-orange-50 text-orange-600 border-orange-200",
    "bg-teal-50 text-teal-600 border-teal-200",
    "bg-indigo-50 text-indigo-600 border-indigo-200",
    "bg-pink-50 text-pink-600 border-pink-200",
  ];
  let hash = 0;
  for (let i = 0; i < keyword.length; i++) {
    hash = keyword.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

const SWIPE_THRESHOLD = 60; // minimum horizontal px to trigger

export default function ArticleList({ articles }: { articles: Article[] }) {
  const [favoritedIds, setFavoritedIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const swipeStartRef = useRef<Record<number, { x: number; y: number } | null>>({});

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  useEffect(() => {
    fetch("/api/favorites")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`お気に入りの取得に失敗しました (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.ids)) {
          setFavoritedIds(new Set(data.ids));
        } else {
          throw new Error("お気に入りのデータ形式が不正です");
        }
      })
      .catch((err) => {
        console.error("Failed to fetch favorites:", err);
        setMessage({
          text: err instanceof Error ? err.message : "お気に入りの取得に失敗しました",
          type: "error",
        });
      });
  }, []);

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
          setFavoritedIds((prev) => {
            const next = new Set(prev);
            if (data.favorited) {
              next.add(articleId);
            } else {
              next.delete(articleId);
            }
            return next;
          });
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
    <div className="space-y-3">
      {message && (
        <div
          className={`fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
          role="alert"
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className={`shrink-0 font-bold ${
              message.type === "success"
                ? "text-green-700 hover:text-green-900"
                : "text-red-700 hover:text-red-900"
            }`}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
      )}
      {articles.map((article) => {
        const isFavorited = favoritedIds.has(article.id);
        return (
          <article
            key={article.id}
            className="group flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4 transition-all duration-200 hover:shadow-sm hover:border-neutral-300"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-semibold leading-snug text-neutral-900 transition-colors hover:text-blue-600 text-base"
                >
                  {article.title}
                </a>
              </div>

              <div
                className="select-none touch-manipulation"
                onPointerDown={(e) => {
                  swipeStartRef.current[article.id] = { x: e.clientX, y: e.clientY };
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                onPointerUp={(e) => {
                  const start = swipeStartRef.current[article.id];
                  if (!start) return;
                  swipeStartRef.current[article.id] = null;
                  const dx = e.clientX - start.x;
                  const dy = e.clientY - start.y;
                  // Horizontal swipe, minimal vertical drift
                  if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dy) < Math.abs(dx) * 0.6) {
                    toggleFav(article.id);
                  }
                }}
                onPointerCancel={() => {
                  swipeStartRef.current[article.id] = null;
                }}
              >
                {article.summary && (
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500 line-clamp-2">
                    {article.summary}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {article.sourceName && (
                    <span className="font-medium text-neutral-600">{article.sourceName}</span>
                  )}
                  <time dateTime={article.publishedAt} className="text-neutral-500">
                    {formatDate(article.publishedAt)}
                  </time>
                  {article.keyword && (
                    <span
                      className={`rounded border px-2 py-0.5 ${getKeywordColor(
                        KEYWORD_LABELS[article.keyword] || article.keyword.split(" ")[0],
                      )}`}
                    >
                      {KEYWORD_LABELS[article.keyword] || article.keyword.split(" ")[0]}
                    </span>
                  )}
                  {article.reason && (
                    <span className="italic text-neutral-400" title={article.reason}>
                      {article.reason}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="ml-4 flex flex-col items-center gap-2">
              <ScoreBadge
                score={article.score}
                relevance={article.relevance}
                usefulness={article.usefulness}
                recency={article.recency}
              />
              <button
                type="button"
                onClick={() => toggleFav(article.id)}
                className="text-xl transition-colors hover:opacity-80 active:scale-110"
                aria-label={isFavorited ? "お気に入り解除" : "お気に入り登録"}
              >
                {isFavorited ? "★" : "☆"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SkeletonCard() {
  return (
    <article className="group flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="min-w-0 flex-1">
        <div className="h-4 w-3/4 rounded bg-neutral-200 animate-pulse mb-2" />
        <div className="h-3 w-full rounded bg-neutral-200 animate-pulse mb-1" />
        <div className="h-3 w-5/6 rounded bg-neutral-200 animate-pulse mb-3" />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="h-3 w-16 rounded bg-neutral-200 animate-pulse" />
          <div className="h-3 w-20 rounded bg-neutral-200 animate-pulse" />
          <div className="h-3 w-12 rounded bg-neutral-200 animate-pulse" />
        </div>
      </div>

      <div className="ml-4">
        <div className="h-12 w-12 rounded-lg bg-neutral-200 animate-pulse" />
      </div>
    </article>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
