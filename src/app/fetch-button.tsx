"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SourceFilter } from "@/components/news/source-filter";
import { FetchAction } from "@/components/news/fetch-action";
import { FetchResult, type FetchResultData } from "@/components/news/fetch-result";
import { useRefresh } from "./refresh-context";
import { invalidateArticlesAfterFetch } from "./actions";

interface FetchResultItem {
  fetched: number;
  saved?: number;
  errors: string[];
  scoringErrors?: string[];
}

interface FetchProgress {
  stage: "fetching" | "selecting" | "scoring" | "cleanup" | "complete";
  completed: number;
  total: number;
  failed: number;
}

function isProgressEvent(value: unknown): value is {
  type: "progress";
  stage: FetchProgress["stage"];
  scoring: Omit<FetchProgress, "stage">;
} {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  const scoring = event.scoring;
  if (typeof scoring !== "object" || scoring === null) return false;
  const counts = scoring as Record<string, unknown>;
  return (
    event.type === "progress" &&
    ["fetching", "selecting", "scoring", "cleanup", "complete"].includes(String(event.stage)) &&
    Number.isFinite(counts.completed) &&
    Number.isFinite(counts.total) &&
    Number.isFinite(counts.failed)
  );
}

function isFetchResultItem(value: unknown): value is FetchResultItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.fetched === "number" &&
    Number.isFinite(item.fetched) &&
    (item.saved === undefined || (typeof item.saved === "number" && Number.isFinite(item.saved))) &&
    Array.isArray(item.errors) &&
    item.errors.every((error) => typeof error === "string") &&
    (item.scoringErrors === undefined ||
      (Array.isArray(item.scoringErrors) &&
        item.scoringErrors.every((error) => typeof error === "string")))
  );
}

function isFetchResponse(value: unknown): value is { ok: true; results: FetchResultItem[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const body = value as Record<string, unknown>;
  return body.ok === true && Array.isArray(body.results) && body.results.every(isFetchResultItem);
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
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [isAwaitingRouteRefresh, setIsAwaitingRouteRefresh] = useState(false);
  const [isRouteRefreshing, startTransition] = useTransition();
  const { isRefreshing, setRefreshing } = useRefresh();
  const awaitingRouteRefreshRef = useRef(false);
  const router = useRouter();

  // Safety timeout: force-clear refreshing after 30 seconds
  useEffect(() => {
    if (!isAwaitingRouteRefresh) return;
    const timer = setTimeout(() => {
      awaitingRouteRefreshRef.current = false;
      setFetchError("一覧の更新を確認できませんでした。ページを再読み込みしてください。");
      setRefreshing(false);
      setIsAwaitingRouteRefresh(false);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [isAwaitingRouteRefresh, setRefreshing]);

  // router.refresh() is not awaitable, but its transition remains pending until
  // the refreshed Server Component payload has been received and committed.
  useEffect(() => {
    if (awaitingRouteRefreshRef.current && !isRouteRefreshing) {
      awaitingRouteRefreshRef.current = false;
      setIsAwaitingRouteRefresh(false);
      setRefreshing(false);
    }
  }, [isRouteRefreshing, setRefreshing]);

  const handleSourceChangeWithRouter = async (newSource: string) => {
    await onSourceChange(newSource);
    const params = new URLSearchParams();
    params.set("source", newSource);
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const handleFetch = useCallback(async () => {
    setApiInFlight(true);
    setRefreshing(true);
    setResults(null);
    setFetchError(null);
    setIsAwaitingRouteRefresh(false);
    setProgress({ stage: "fetching", completed: 0, total: 0, failed: 0 });

    try {
      const res = await fetch("/api/fetch-news", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ source: selectedSource }),
      });
      if (!res.ok) {
        setFetchError("ニュース取得に失敗しました");
        setRefreshing(false);
        return;
      }
      let data: unknown;
      let cacheInvalidationToken: string | null = null;
      let receivedProgressStream = false;
      if (res.headers.get("content-type")?.includes("application/x-ndjson")) {
        receivedProgressStream = true;
        if (!res.body) throw new Error("Missing progress stream");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        data = null;
        let streamError = false;
        const handleLine = (line: string) => {
          if (!line.trim()) return;
          const event: unknown = JSON.parse(line);
          if (isProgressEvent(event)) {
            setProgress({
              stage: event.stage,
              completed: event.scoring.completed,
              total: event.scoring.total,
              failed: event.scoring.failed,
            });
          } else if (typeof event === "object" && event !== null && "type" in event) {
            const terminal = event as Record<string, unknown>;
            if (terminal.type === "result") {
              data = terminal;
              cacheInvalidationToken =
                typeof terminal.cacheInvalidationToken === "string"
                  ? terminal.cacheInvalidationToken
                  : null;
            } else if (terminal.type === "error") streamError = true;
            else throw new Error("Invalid fetch progress event");
          } else {
            throw new Error("Invalid fetch progress event");
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) handleLine(line);
          if (done) break;
        }
        if (buffer.trim()) handleLine(buffer);

        if (streamError || data === null) {
          setFetchError("ニュース取得に失敗しました");
          setRefreshing(false);
          return;
        }
      } else {
        // Compatibility with servers still returning the legacy JSON response.
        data = await res.json();
      }

      if (res.ok && isFetchResponse(data)) {
        const totalFetched = data.results.reduce(
          (acc: number, r: FetchResultItem) => acc + r.fetched,
          0,
        );
        const totalSaved = data.results.reduce(
          (acc: number, r: FetchResultItem) => acc + (r.saved ?? 0),
          0,
        );
        if (!Number.isFinite(totalFetched) || !Number.isFinite(totalSaved)) {
          setFetchError("ニュース取得に失敗しました");
          setRefreshing(false);
          return;
        }

        const hasErrors = data.results.some((r: FetchResultItem) => r.errors.length > 0);
        const scoringErrors = data.results.flatMap((r: FetchResultItem) => r.scoringErrors ?? []);

        setResults([
          {
            keyword: "latest",
            fetched: totalFetched,
            scored: totalSaved,
            processed: totalFetched,
            errors: hasErrors ? ["一部の処理でエラーが発生しました"] : [],
            scoringErrors,
          },
        ]);

        if (receivedProgressStream) {
          try {
            if (!cacheInvalidationToken) throw new Error("Missing cache invalidation token");
            await invalidateArticlesAfterFetch(cacheInvalidationToken);
          } catch {
            setFetchError("一覧の更新を確認できませんでした。ページを再読み込みしてください。");
            setRefreshing(false);
            return;
          }
        }

        awaitingRouteRefreshRef.current = true;
        setIsAwaitingRouteRefresh(true);
        startTransition(() => {
          router.refresh();
        });
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
      <div className="flex items-center gap-2 border-b border-border pb-3 sm:gap-3 sm:pb-4">
        <SourceFilter value={selectedSource} onSourceChange={handleSourceChangeWithRouter} />
        <FetchAction isLoading={apiInFlight} onFetch={handleFetch} className="ml-auto" />
      </div>

      <FetchResult results={results} error={fetchError} />

      {isRefreshing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-muted-foreground" />
          {progress?.stage === "scoring"
            ? `採点中 ${progress.completed} / ${progress.total}（失敗 ${progress.failed}）`
            : progress?.stage === "selecting"
              ? "対象選定中..."
              : progress?.stage === "cleanup" || progress?.stage === "complete"
                ? "取得結果を整理中..."
                : "記事取得中..."}
        </div>
      )}
    </div>
  );
}
