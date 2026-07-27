"use client";

import { useState } from "react";
import { ColumnDef } from "../../lib/table-config";

interface RowDetailProps {
  row: any;
  columns: ColumnDef[];
  onClose: () => void;
}

export default function RowDetail({ row, columns, onClose }: RowDetailProps) {
  const [showEmbeddingFull, setShowEmbeddingFull] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-neutral-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
          <h3 className="font-bold text-neutral-900 text-base">
            Row Detail{" "}
            <span className="font-mono text-xs text-neutral-500 font-normal"># {row.id}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-lg font-bold p-1"
          >
            ×
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 divide-y divide-neutral-100">
          {Object.entries(row).map(([key, val]) => {
            const isEmbedding = key === "embedding";
            const stringVal = val === null || val === undefined ? "—" : String(val);

            return (
              <div key={key} className="pt-4 first:pt-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 font-mono">
                    {key}
                  </span>
                  <span className="text-xs text-neutral-400 font-mono">{typeof val}</span>
                </div>

                {isEmbedding ? (
                  <div>
                    <div className="bg-neutral-50 border border-neutral-200 rounded p-3 font-mono text-xs text-neutral-700 max-h-32 overflow-y-auto">
                      {showEmbeddingFull
                        ? stringVal
                        : stringVal.slice(0, 150) + (stringVal.length > 150 ? "..." : "")}
                    </div>
                    {stringVal.length > 150 && (
                      <button
                        onClick={() => setShowEmbeddingFull(!showEmbeddingFull)}
                        className="text-xs text-blue-600 hover:underline mt-1 font-medium"
                      >
                        {showEmbeddingFull ? "Collapse embedding" : "Show full embedding"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm text-neutral-800 whitespace-pre-wrap break-all font-mono">
                    {stringVal}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-neutral-300 rounded-md text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
