"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SOURCES } from "@/lib/sources";

interface FetchResult {
  keyword: string;
  fetched: number;
  scored: number;
  processed: number;
  errors: string[];
}

export default function FetchButton() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FetchResult[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>(() => {
    // Load from localStorage on mount
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("selectedSources");
      return saved ? JSON.parse(saved) : SOURCES.map((s) => s.id);
    }
    return SOURCES.map((s) => s.id);
  });
  const router = useRouter();

  // Save to localStorage when selection changes
  useEffect(() => {
    localStorage.setItem("selectedSources", JSON.stringify(selectedSources));
  }, [selectedSources]);

  // Mount effect: sync URL with localStorage (initial load from localStorage may have saved state)
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedSources.length > 0) {
      params.set("sources", selectedSources.join(","));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSourceToggle = useCallback(
    (sourceId: string) => {
      setSelectedSources((prev) => {
        const next = prev.includes(sourceId)
          ? prev.filter((id) => id !== sourceId)
          : [...prev, sourceId];
        // Update URL search params
        const params = new URLSearchParams();
        if (next.length > 0) params.set("sources", next.join(","));
        router.replace(`?${params.toString()}`, { scroll: false });
        return next;
      });
    },
    [router],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedSources(SOURCES.map((s) => s.id));
    const params = new URLSearchParams();
    params.set("sources", SOURCES.map((s) => s.id).join(","));
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router]);

  const handleSelectNone = useCallback(() => {
    setSelectedSources([]);
    router.replace("?", { scroll: false });
  }, [router]);

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setResults(null);
    setFetchError(null);
    setShowDetail(false);

    try {
      const res = await fetch("/api/fetch-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: selectedSources }),
      });
      const data = await res.json();

      if (data.ok && Array.isArray(data.results)) {
        // Scoring is done inline before fetch-news returns, so use the
        // response directly — no polling needed.
        const totalFetched = data.results.reduce(
          (acc: number, r: any) => acc + (r.fetched || 0),
          0,
        );
        const totalSaved = data.results.reduce((acc: number, r: any) => acc + (r.saved || 0), 0);
        const hasErrors = data.results.some(
          (r: any) => Array.isArray(r.errors) && r.errors.length > 0,
        );

        setResults([
          {
            keyword: "latest",
            fetched: totalFetched,
            scored: totalSaved,
            processed: totalFetched,
            errors: hasErrors ? ["一部の処理でエラーが発生しました"] : [],
          },
        ]);
        setLoading(false);
        router.refresh();
      } else {
        setFetchError("ニュース取得に失敗しました");
        setLoading(false);
      }
    } catch {
      setFetchError("通信エラーが発生しました");
      setLoading(false);
    }
  }, [router, selectedSources]);

  const hasAnyErrors = results?.some((r) => r.errors.length > 0);

  const selectedSourcesList = SOURCES.filter((s) => selectedSources.includes(s.id));

  return (
    <div className="flex flex-col gap-3">
      {/* Source Selection */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-600">データソースを選択</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              すべて選択
            </button>
            <span className="text-xs text-neutral-300">|</span>
            <button
              type="button"
              onClick={handleSelectNone}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              選択解除
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SOURCES.map((source) => (
            <label
              key={source.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100"
            >
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={selectedSources.includes(source.id)}
                  onChange={() => handleSourceToggle(source.id)}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                />
                <div
                  className={`absolute inset-0 rounded-full ${source.color} opacity-20 ${selectedSources.includes(source.id) ? "block" : "hidden"}`}
                />
              </div>
              <span className="text-xs font-medium text-neutral-700">{source.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          {selectedSources.length} / {SOURCES.length} を選択中
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleFetch}
          disabled={loading || selectedSources.length === 0}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "取得・スコアリング中..." : "ニュースを取得してスコアリング"}
        </button>
        <span className="text-xs text-neutral-400">NewsAPI → LLMスコアリング</span>
      </div>

      {fetchError && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {fetchError}
          <button type="button" onClick={handleFetch} className="ml-2 underline hover:no-underline">
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
