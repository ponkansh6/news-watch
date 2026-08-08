"use client";

import { Loader2 } from "lucide-react";
import { useRefresh } from "@/app/refresh-context";

interface FetchActionProps {
  isLoading: boolean;
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
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRefreshing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>取得・スコアリング中...</span>
          </>
        ) : (
          <span>ニュースを取得してスコアリング</span>
        )}
      </button>
    </div>
  );
}
