"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { SourceFilter } from "@/components/news/source-filter";
import { FetchAction } from "@/components/news/fetch-action";
import { FetchResult, type FetchResultData } from "@/components/news/fetch-result";
import { useRefresh } from "./refresh-context";
import { invalidateArticlesAfterFetch } from "./actions";
import { isSourceSelection, SOURCES, type SourceSelection } from "@/lib/sources";

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

type AggregateJobStatus =
  | "enqueue_unknown"
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "needs_reconciliation";

interface AggregateJobSource {
  sourceId: string;
  status: "pending" | "executing" | "saved" | "invalidated" | "failed" | "unknown";
  resultCount: number | null;
  errorCode: string | null;
  cacheInvalidatedAt: string | null;
}

interface AggregateJob {
  jobId: string;
  status: AggregateJobStatus;
  revision: number;
  currentSourceId: string | null;
  errorCode: string | null;
  sources: AggregateJobSource[];
}

function isAggregateJob(value: unknown): value is AggregateJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.jobId === "string" &&
    typeof job.revision === "number" &&
    [
      "enqueue_unknown",
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "needs_reconciliation",
    ].includes(String(job.status)) &&
    Array.isArray(job.sources) &&
    job.sources.every((source) => {
      if (typeof source !== "object" || source === null) return false;
      const item = source as Record<string, unknown>;
      return (
        typeof item.sourceId === "string" &&
        ["pending", "executing", "saved", "invalidated", "failed", "unknown"].includes(
          String(item.status),
        )
      );
    })
  );
}

function isActiveAggregateJob(job: AggregateJob): boolean {
  return isActiveAggregateStatus(job.status);
}

function isActiveAggregateStatus(status: AggregateJobStatus): boolean {
  return !["completed", "partial", "failed", "needs_reconciliation"].includes(status);
}

function holdsAggregateSlot(job: AggregateJob): boolean {
  return isActiveAggregateJob(job) || job.status === "needs_reconciliation";
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
  selectedSource: SourceSelection;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onSourceChange: (source: SourceSelection) => Promise<void>;
}

export default function FetchButton({ selectedSource, onSourceChange }: FetchButtonProps) {
  const [apiInFlight, setApiInFlight] = useState(false);
  const [results, setResults] = useState<FetchResultData[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [aggregateJob, setAggregateJob] = useState<AggregateJob | null>(null);
  const [aggregateLoading, setAggregateLoading] = useState(false);
  const [aggregateError, setAggregateError] = useState<string | null>(null);
  const [isAwaitingRouteRefresh, setIsAwaitingRouteRefresh] = useState(false);
  const [isRouteRefreshing, startTransition] = useTransition();
  const { isRefreshing, setRefreshing } = useRefresh();
  const awaitingRouteRefreshRef = useRef(false);
  const previousInvalidationsRef = useRef<Map<string, string>>(new Map());
  const router = useRouter();

  // A mounted page can rejoin an active server job. Aborting these reads only
  // stops browser polling; it never cancels the durable Workflow.
  useEffect(() => {
    if (selectedSource !== "all") return;
    const controller = new AbortController();
    let active = true;
    void fetch("/api/refresh-jobs", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return (await response.json()) as { job?: unknown };
      })
      .then((body) => {
        if (!active || !isAggregateJob(body.job)) return;
        setAggregateJob(body.job);
        setRefreshing(isActiveAggregateJob(body.job));
        if (body.job.sources.some((source) => source.cacheInvalidatedAt)) {
          startTransition(() => router.refresh());
        }
      })
      .catch(() => {
        // Status restoration is best-effort; an API outage does not start work.
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [router, selectedSource, setRefreshing]);

  const aggregateJobId = aggregateJob?.jobId;
  const aggregateJobStatus = aggregateJob?.status;

  useEffect(() => {
    if (!aggregateJobId || !aggregateJobStatus || !isActiveAggregateStatus(aggregateJobStatus)) {
      if (aggregateJobId) setRefreshing(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let shouldContinuePolling = true;

    const poll = async () => {
      try {
        const response = await fetch(`/api/refresh-jobs/${encodeURIComponent(aggregateJobId)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("status unavailable");
        const body = (await response.json()) as { job?: unknown };
        if (!active || !isAggregateJob(body.job)) return;

        const nextJob = body.job;
        const previous = previousInvalidationsRef.current;
        const hasNewInvalidation = nextJob.sources.some((source) => {
          const previousValue = previous.get(source.sourceId);
          return source.cacheInvalidatedAt !== null && source.cacheInvalidatedAt !== previousValue;
        });
        previousInvalidationsRef.current = new Map(
          nextJob.sources
            .filter((source) => source.cacheInvalidatedAt !== null)
            .map((source) => [source.sourceId, source.cacheInvalidatedAt as string]),
        );
        setAggregateJob(nextJob);

        shouldContinuePolling = isActiveAggregateJob(nextJob);
        if (hasNewInvalidation || !shouldContinuePolling) {
          startTransition(() => router.refresh());
        }
        if (!shouldContinuePolling) setRefreshing(false);
      } catch {
        if (active && shouldContinuePolling && !controller.signal.aborted) {
          setAggregateError("更新状況を取得できません。しばらくしてから再読み込みしてください。");
        }
      } finally {
        if (active && shouldContinuePolling && !controller.signal.aborted) {
          timer = setTimeout(() => void poll(), 2_000);
        }
      }
    };

    setRefreshing(true);
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
      setRefreshing(false);
    };
  }, [aggregateJobId, aggregateJobStatus, router, setRefreshing]);

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
    if (!isSourceSelection(newSource)) return;
    await onSourceChange(newSource);
    const params = new URLSearchParams();
    params.set("source", newSource);
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const handleFetch = useCallback(async () => {
    if (selectedSource === "all") return;

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
        if (res.status === 409) {
          const busy = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          if (typeof busy?.jobId === "string") {
            const statusResponse = await fetch(
              `/api/refresh-jobs/${encodeURIComponent(busy.jobId)}`,
            );
            const statusBody = (await statusResponse.json()) as { job?: unknown };
            if (statusResponse.ok && isAggregateJob(statusBody.job)) {
              setAggregateError(null);
              setAggregateJob(statusBody.job);
              setRefreshing(isActiveAggregateJob(statusBody.job));
              setApiInFlight(false);
              return;
            }
          }
          setFetchError("別の更新処理が実行中です。完了後に再度お試しください。");
          setRefreshing(false);
          return;
        }
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

  const handleAggregateFetch = useCallback(async () => {
    if (aggregateLoading || (aggregateJob && isActiveAggregateJob(aggregateJob))) return;
    setAggregateLoading(true);
    setAggregateError(null);
    setResults(null);
    setFetchError(null);

    try {
      const response = await fetch("/api/refresh-jobs", { method: "POST" });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 409) {
        if (typeof body.jobId === "string") {
          const statusResponse = await fetch(`/api/refresh-jobs/${encodeURIComponent(body.jobId)}`);
          const statusBody = (await statusResponse.json()) as { job?: unknown };
          if (statusResponse.ok && isAggregateJob(statusBody.job)) {
            setAggregateJob(statusBody.job);
            setRefreshing(isActiveAggregateJob(statusBody.job));
            return;
          }
        }
        setAggregateError("個別ソースの更新が実行中です。完了後に再度お試しください。");
        return;
      }

      if (!response.ok || typeof body.jobId !== "string" || !Array.isArray(body.sources)) {
        throw new Error("invalid job response");
      }
      const jobCandidate = {
        jobId: body.jobId,
        status: body.status,
        revision: body.revision,
        currentSourceId: null,
        errorCode: null,
        sources: body.sources,
      };
      if (!isAggregateJob(jobCandidate)) throw new Error("invalid job response");
      previousInvalidationsRef.current.clear();
      setAggregateJob(jobCandidate);
      setRefreshing(true);
    } catch {
      setAggregateError("一括更新を開始できませんでした。しばらくしてから再度お試しください。");
    } finally {
      setAggregateLoading(false);
    }
  }, [aggregateJob, aggregateLoading, setRefreshing]);

  const sourceName = (sourceId: string) =>
    SOURCES.find((source) => source.id === sourceId)?.name ?? sourceId;
  const refreshStatusLabel = (job: AggregateJob) => {
    switch (job.status) {
      case "enqueue_unknown":
        return "開始状況を確認中...";
      case "queued":
        return "更新を準備中...";
      case "running":
        return "全ソースを順番に更新中...";
      case "completed":
        return "総合更新が完了しました";
      case "partial":
        return "一部のソースでエラーがありました";
      case "failed":
        return "総合更新に失敗しました";
      case "needs_reconciliation":
        return "更新状況を確認できません。自動再実行は行いません。管理者による確認が必要です。";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 border-b border-border pb-3 sm:gap-3 sm:pb-4">
        <SourceFilter value={selectedSource} onSourceChange={handleSourceChangeWithRouter} />
        {selectedSource === "all" ? (
          <button
            type="button"
            onClick={() => void handleAggregateFetch()}
            disabled={
              aggregateLoading || (aggregateJob !== null && holdsAggregateSlot(aggregateJob))
            }
            aria-label={
              aggregateJob?.status === "needs_reconciliation"
                ? "更新状況の確認が必要です"
                : aggregateLoading
                  ? "総合更新を開始中..."
                  : "全ソースを一括更新"
            }
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aggregateJob?.status === "needs_reconciliation" ? (
              <span>要確認</span>
            ) : aggregateLoading ||
              (aggregateJob !== null && isActiveAggregateJob(aggregateJob)) ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                <span>更新中...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                <span>全ソースを更新</span>
              </>
            )}
          </button>
        ) : aggregateJob?.status === "needs_reconciliation" ? (
          <span role="status" className="ml-auto max-w-xs text-right text-xs text-destructive">
            管理者の確認が終わるまで更新を停止しています
          </span>
        ) : (
          <FetchAction isLoading={apiInFlight} onFetch={handleFetch} className="ml-auto" />
        )}
      </div>

      {(aggregateJob || aggregateError) && (
        <section
          className="space-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm"
          aria-label="総合更新の進捗"
        >
          {aggregateError ? (
            <p role="alert" className="text-destructive">
              {aggregateError}
            </p>
          ) : aggregateJob ? (
            <>
              <p
                role="status"
                aria-live="polite"
                className={
                  aggregateJob.status === "failed" ||
                  aggregateJob.status === "partial" ||
                  aggregateJob.status === "needs_reconciliation"
                    ? "text-destructive"
                    : "font-medium"
                }
              >
                {refreshStatusLabel(aggregateJob)}
              </p>
              <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                {aggregateJob.sources.map((source) => {
                  const label =
                    source.status === "invalidated"
                      ? `完了 ${source.resultCount ?? 0}件`
                      : source.status === "saved"
                        ? "一覧を更新中..."
                        : source.status === "executing"
                          ? "取得・採点中..."
                          : source.status === "failed" || source.status === "unknown"
                            ? "失敗"
                            : "待機中";
                  return (
                    <li key={source.sourceId} className="flex justify-between gap-2">
                      <span>{sourceName(source.sourceId)}</span>
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
      )}

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
