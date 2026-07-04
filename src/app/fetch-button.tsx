"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface FetchResult {
  keyword: string;
  fetched: number;
  scored: number;
  errors: string[];
}

export default function FetchButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const router = useRouter();

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/fetch-news", { method: "POST" });
      const data = await res.json();

      if (data.ok) {
        const total = (data.results as FetchResult[]).reduce(
          (acc: number, r: FetchResult) => acc + r.scored,
          0,
        );
        setResult({ ok: true, message: `${total}件のニュースをスコアリングしました` });
      } else {
        setResult({ ok: false, message: "ニュース取得に失敗しました" });
      }

      // 少し待ってからページをリフレッシュ
      setTimeout(() => router.refresh(), 1500);
    } catch {
      setResult({ ok: false, message: "通信エラーが発生しました" });
    } finally {
      setLoading(false);
    }
  }, [router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleFetch}
          disabled={loading}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "取得・スコアリング中..." : "ニュースを取得してスコアリング"}
        </button>
        <span className="text-xs text-neutral-400">
          GNews / NewsAPI から取得 → LLMでスコアリング
        </span>
      </div>

      {result && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            result.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
