"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PREFERENCE_MIN_FAVORITES } from "@/lib/constants";

export default function AnalyzeButton({
  favoriteCount,
  minFavorites = PREFERENCE_MIN_FAVORITES,
  lastAnalyzedAt,
}: {
  favoriteCount: number;
  minFavorites?: number;
  lastAnalyzedAt: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const router = useRouter();

  const disabled = loading || favoriteCount < minFavorites;

  const handleClick = async () => {
    if (disabled) return;
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/favorites/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setMessage({
          text: data?.reused ? "分析結果を再利用しました" : "嗜好プロファイルを更新しました",
          type: "success",
        });
        router.refresh();
      } else {
        setMessage({
          text: data?.error ?? `分析に失敗しました (${res.status})`,
          type: "error",
        });
      }
    } catch {
      setMessage({ text: "ネットワークエラーが発生しました", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          disabled={disabled}
          onClick={handleClick}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "分析中…（最大45秒）" : "傾向を分析"}
        </button>
      </div>
      {favoriteCount < minFavorites && (
        <span className="text-xs text-muted-foreground">
          お気に入りが{minFavorites}件以上で分析できます（現在 {favoriteCount} 件）
        </span>
      )}
      {message && (
        <span
          aria-live="polite"
          className={`text-xs ${message.type === "success" ? "text-score-high" : "text-destructive"}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
