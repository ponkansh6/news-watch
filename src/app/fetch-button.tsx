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
  const [results, setResults] = useState<FetchResult[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const router = useRouter();

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setResults(null);
    setFetchError(null);
    setShowDetail(false);

    try {
      const res = await fetch("/api/fetch-news", { method: "POST" });
      const data = await res.json();

      if (data.ok && Array.isArray(data.results)) {
        setResults(data.results as FetchResult[]);
        const total = (data.results as FetchResult[]).reduce(
          (acc: number, r: FetchResult) => acc + r.scored,
          0,
        );
        const allFailed = (data.results as FetchResult[]).every(
          (r) => r.errors.length > 0,
        );
        if (allFailed) {
          setFetchError("すべてのキーワードで取得に失敗しました。GNews / NewsAPI のAPIキーを確認してください。");
        }
      } else {
        setFetchError("ニュース取得に失敗しました");
      }

      // 少し待ってからページをリフレッシュ
      setTimeout(() => router.refresh(), 1500);
    } catch {
      setFetchError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const hasAnyErrors = results?.some((r) => r.errors.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleFetch}
          disabled={loading}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "取得・スコアリング中..." : "ニュースを取得してスコアリング"}
        </button>
        <span className="text-xs text-neutral-400">
          GNews / NewsAPI → LLMスコアリング
        </span>
      </div>

      {fetchError && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {fetchError}
          <button
            type="button"
            onClick={handleFetch}
            className="ml-2 underline hover:no-underline"
          >
            リトライ
          </button>
        </div>
      )}

      {results && !fetchError && (
        <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-neutral-700">
              {results.reduce((a, r) => a + r.scored, 0)}件 スコアリング完了
            </span>
            <button
              type="button"
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              {showDetail ? "閉じる" : "詳細を表示"}
            </button>
          </div>

          {showDetail && (
            <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3">
              {results.map((r) => (
                <div key={r.keyword} className="flex items-center justify-between">
                  <span className="font-medium text-neutral-600">{r.keyword}</span>
                  <span className="flex items-center gap-1.5">
                    {r.errors.length > 0 ? (
                      <span className="text-red-500" title={r.errors.join("; ")}>
                        {r.fetched}件取得 / {r.scored}件スコアリング ⚠
                      </span>
                    ) : (
                      <span className="text-emerald-600">
                        {r.fetched}件取得 / {r.scored}件スコアリング ✅
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-neutral-400" />
          キーワードを処理中...
        </div>
      )}
    </div>
  );
}
