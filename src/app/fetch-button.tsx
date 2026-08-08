"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SourceFilter } from "@/components/news/source-filter";
import { FetchAction } from "@/components/news/fetch-action";
import { FetchResult } from "@/components/news/fetch-result";
import { useRefresh } from "./refresh-context";
import { SOURCES } from "@/lib/sources";

interface FetchResultData {
  keyword: string;
  fetched: number;
  scored: number;
  processed: number;
  errors: string[];
}

interface FetchResultItem {
  fetched?: number;
  saved?: number;
  errors?: string[];
}

interface FetchButtonProps {
  selectedSource: string;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onSourceChange: (source: string) => Promise<void>;
}

export default function FetchButton({ selectedSource, onSourceChange }: FetchButtonProps) {
  const [apiInFlight, setApiInFlight] = useState(false);
  const [results, setResults] = useState<FetchResultData[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { isRefreshing, setRefreshing } = useRefresh();
  const refreshFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Safety timeout: force-clear refreshing after 30 seconds
  useEffect(() => {
    if (!isRefreshing) return;
    const timer = setTimeout(() => {
      setRefreshing(false);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [isRefreshing, setRefreshing]);

  // Cleanup fallback timer on unmount
  useEffect(() => {
    return () => {
      if (refreshFallbackRef.current) {
        clearTimeout(refreshFallbackRef.current);
        refreshFallbackRef.current = null;
      }
    };
  }, []);

  const handleSourceChangeWithRouter = async (newSource: string) => {
    startTransition(async () => {
      await onSourceChange(newSource);
      const params = new URLSearchParams();
      params.set("source", newSource);
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  const handleFetch = useCallback(async () => {
    setApiInFlight(true);
    setRefreshing(true);
    setResults(null);
    setFetchError(null);

    try {
      const res = await fetch("/api/fetch-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: selectedSource }),
      });
      const data = await res.json();

      if (data.ok && Array.isArray(data.results)) {
        const totalFetched = data.results.reduce(
          (acc: number, r: FetchResultItem) => acc + (r.fetched || 0),
          0,
        );
        const totalSaved = data.results.reduce(
          (acc: number, r: FetchResultItem) => acc + (r.saved || 0),
          0,
        );
        const hasErrors = data.results.some(
          (r: FetchResultItem) => Array.isArray(r.errors) && r.errors.length > 0,
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

        startTransition(() => {
          router.refresh();
        });

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <SourceFilter value={selectedSource} onSourceChange={handleSourceChangeWithRouter} />
        <span className="text-sm text-muted-foreground">
          {SOURCES.find((s) => s.id === selectedSource)?.name} ソース
        </span>
        <FetchAction isLoading={apiInFlight} onFetch={handleFetch} className="ml-auto" />
      </div>

      <FetchResult results={results} error={fetchError} />

      {isRefreshing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-muted-foreground" />
          記事を更新中...
        </div>
      )}
    </div>
  );
}
