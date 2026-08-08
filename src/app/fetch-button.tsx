"use client";

import { useState, useEffect, useCallback, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { SOURCES } from "@/lib/sources";
import { useRefresh } from "./refresh-context";

interface FetchResult {
  keyword: string;
  fetched: number;
  scored: number;
  processed: number;
  errors: string[];
}

export default function FetchButton() {
  const [apiInFlight, setApiInFlight] = useState(false);
  const [results, setResults] = useState<FetchResult[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { isRefreshing, setRefreshing, setFiltering } = useRefresh();
  const refreshFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>(() => {
    // Load from localStorage on mount
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("selectedSource");
      return saved ? saved : "zenn";
    }
    return "zenn";
  });
  const router = useRouter();

  // Save to localStorage when selection changes
  useEffect(() => {
    localStorage.setItem("selectedSource", selectedSource);
  }, [selectedSource]);

  // Mount effect: sync URL with localStorage
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedSource) {
      params.set("source", selectedSource);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety timeout: force-clear refreshing after 30 seconds to prevent
  // infinite skeleton if no new articles are scored above threshold.
  useEffect(() => {
    if (!isRefreshing) return;
    const timer = setTimeout(() => {
      setRefreshing(false);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [isRefreshing, setRefreshing]);

  // Sync transition pending state → isFiltering context for source filter loading indicator
  useEffect(() => {
    // Only set filtering when NOT in a scoring refresh (isRefreshing handles scoring)
    if (!isRefreshing) {
      setFiltering(isPending);
    }
  }, [isPending, isRefreshing, setFiltering]);

  // Cleanup fallback timer on unmount
  useEffect(() => {
    return () => {
      if (refreshFallbackRef.current) {
        clearTimeout(refreshFallbackRef.current);
        refreshFallbackRef.current = null;
      }
    };
  }, []);

  const handleSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSource = e.target.value;
      setSelectedSource(newSource);
      const params = new URLSearchParams();
      params.set("source", newSource);
      startTransition(() => {
        router.replace(`?${params.toString()}`, { scroll: false });
      });
    },
    [router, startTransition],
  );

  const handleFetch = useCallback(async () => {
    setApiInFlight(true);
    setRefreshing(true);
    setResults(null);
    setFetchError(null);
    setShowDetail(false);

    try {
      const res = await fetch("/api/fetch-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: selectedSource }),
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
        // Keep loading visible during RSC refresh
        // isRefreshing is already true (set above)
        startTransition(() => {
          router.refresh();
        });
        // Fallback: if NewsSection doesn't detect new articles within 5s
        // (e.g., API returned saved=0 so no new IDs appear), clear refreshing
        // to prevent stuck skeleton.
        if (refreshFallbackRef.current) {
          clearTimeout(refreshFallbackRef.current);
        }
        refreshFallbackRef.current = setTimeout(() => {
          setRefreshing(false);
          refreshFallbackRef.current = null;
        }, 5_000);
      } else {
        setFetchError("ニュース取得に失敗しました");
        setRefreshing(false);
      }
    } catch {
      setFetchError("通信エラーが発生しました");
      setRefreshing(false);
    } finally {
      setApiInFlight(false);
    }
  }, [router, selectedSource, setRefreshing]);

  return (
    <div className="flex flex-col gap-3">
      {/* Source Selection */}
      <div className="rounded-lg border border-border bg-muted p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">データソース</span>
          <span className="text-xs text-muted-foreground">
            {isPending && !isRefreshing && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                フィルタリング中...
              </span>
            )}
          </span>
        </div>
        <select
          value={selectedSource}
          onChange={handleSourceChange}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        >
          {SOURCES.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleFetch}
          disabled={apiInFlight || !selectedSource}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {apiInFlight ? "取得・スコアリング中..." : "ニュースを取得してスコアリング"}
        </button>
        <span className="text-xs text-muted-foreground">
          {SOURCES.find((s) => s.id === selectedSource)?.name} → LLMスコアリング
        </span>
      </div>

      {fetchError && (
        <div className="rounded-lg bg-destructive/15 px-4 py-2 text-sm text-destructive">
          {fetchError}
          <button type="button" onClick={handleFetch} className="ml-2 underline hover:no-underline">
            リトライ
          </button>
        </div>
      )}

      {results && !fetchError && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              {results.reduce((a, r) => a + r.scored, 0)}件 スコアリング完了
            </span>
            <button
              type="button"
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetail ? "閉じる" : "詳細を表示"}
            </button>
          </div>

          {showDetail && (
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {results.map((r) => (
                <div key={r.keyword} className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">合計</span>
                  <span className="flex items-center gap-1.5">
                    {r.errors.length > 0 ? (
                      <span className="text-destructive" title={r.errors.join("; ")}>
                        {r.fetched}件取得 / {r.scored}件スコアリング ⚠
                      </span>
                    ) : (
                      <span className="text-score-high">
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

      {isRefreshing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-muted-foreground" />
          記事を更新中...
        </div>
      )}
    </div>
  );
}
