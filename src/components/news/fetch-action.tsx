"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRefresh } from "@/app/refresh-context";

interface FetchActionProps {
  isLoading: boolean;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onFetch: () => void;
  className?: string;
}

export function FetchAction({ isLoading, onFetch, className }: FetchActionProps) {
  const { isRefreshing } = useRefresh();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onFetch}
        disabled={isLoading || isRefreshing}
        aria-label={isRefreshing ? "取得・スコアリング中..." : "ニュースを取得してスコアリング"}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 min-h-11 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRefreshing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="sm:hidden">取得中...</span>
            <span className="hidden sm:inline">取得・スコアリング中...</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 sm:hidden" />
            <span className="sm:hidden">取得</span>
            <span className="hidden sm:inline">ニュースを取得してスコアリング</span>
          </>
        )}
      </button>
    </div>
  );
}
