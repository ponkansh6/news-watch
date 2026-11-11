"use client";

import { useState } from "react";
import type { AssertSerializable } from "@/lib/serializable";

type RowDetailProps = AssertSerializable<{
  row: Record<string, unknown>;
}> & {
  // eslint-disable-next-line @sbougerel/next-use-client-boundary/props-must-be-serializable
  onClose: () => void; // function is allowed cross client-to-client
};

export default function RowDetail({ row, onClose }: RowDetailProps) {
  const [showEmbeddingFull, setShowEmbeddingFull] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-5 py-4 sm:px-6">
          <h3 className="font-bold text-foreground text-base">
            Row Detail{" "}
            <span className="font-mono text-xs text-muted-foreground font-normal">
              # {String(row.id ?? "")}
            </span>
          </h3>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flex size-10 items-center justify-center text-lg font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 divide-y divide-border overflow-y-auto p-5 sm:p-6">
          {Object.entries(row as Record<string, unknown>).map(([key, val]) => {
            const isEmbedding = key === "embedding";
            const stringVal = val === null || val === undefined ? "—" : String(val);

            return (
              <div key={key} className="pt-4 first:pt-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                    {key}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">{typeof val}</span>
                </div>

                {isEmbedding ? (
                  <div>
                    <div className="bg-muted border border-border rounded p-3 font-mono text-xs text-foreground/90 max-h-32 overflow-y-auto">
                      {showEmbeddingFull
                        ? stringVal
                        : stringVal.slice(0, 150) + (stringVal.length > 150 ? "..." : "")}
                    </div>
                    {stringVal.length > 150 && (
                      <button
                        onClick={() => setShowEmbeddingFull(!showEmbeddingFull)}
                        className="text-xs text-primary hover:underline mt-1 font-medium"
                      >
                        {showEmbeddingFull ? "Collapse embedding" : "Show full embedding"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-muted border border-border rounded p-3 text-sm text-foreground whitespace-pre-wrap break-all font-mono">
                    {stringVal}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-3 border-t border-border bg-muted flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-card border border-border rounded-md text-sm font-medium text-foreground/90 hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
