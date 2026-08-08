"use client";

import { useTransition } from "react";
import { SOURCES } from "@/lib/sources";

interface SourceFilterProps {
  value: string;
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onSourceChange: (source: string) => Promise<void>;
}

export function SourceFilter({ value, onSourceChange }: SourceFilterProps) {
  const [isPending, startTransition] = useTransition();

  const handleSourceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSource = e.target.value;
    startTransition(async () => {
      await onSourceChange(newSource);
    });
  };

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="source-select" className="text-xs font-medium text-muted-foreground">
        データソース
      </label>
      <select
        id="source-select"
        value={value}
        onChange={handleSourceChange}
        disabled={isPending}
        className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
        {SOURCES.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      {isPending && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          フィルタリング中...
        </span>
      )}
    </div>
  );
}
