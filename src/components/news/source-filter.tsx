"use client";

import { useTransition } from "react";
import { isSourceSelection, SOURCE_FILTER_OPTIONS, type SourceSelection } from "@/lib/sources";

interface SourceFilterProps {
  value: SourceSelection;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onSourceChange: (source: SourceSelection) => Promise<void>;
}

export function SourceFilter({ value, onSourceChange }: SourceFilterProps) {
  const [isPending, startTransition] = useTransition();

  const handleSourceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSource = e.target.value;
    if (!isSourceSelection(newSource)) return;

    startTransition(async () => {
      try {
        await onSourceChange(newSource);
      } catch {
        // Keep a failed source update from leaving the filter pending or
        // producing an unhandled rejection from the transition callback.
      }
    });
  };

  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <label
        htmlFor="source-select"
        className="shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground sm:text-xs"
      >
        データソース
      </label>
      <select
        id="source-select"
        value={value}
        onChange={handleSourceChange}
        disabled={isPending}
        className="h-11 min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-[0_1px_0_rgb(15_23_42/0.03)] outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
      >
        {SOURCE_FILTER_OPTIONS.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      {isPending && (
        <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          フィルタリング中...
        </span>
      )}
    </div>
  );
}
