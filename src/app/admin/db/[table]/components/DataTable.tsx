"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AssertSerializable } from "@/lib/serializable";
import RowDetail from "./RowDetail";

// Serializable column type (without format function — pre-formatted on server)
interface Column {
  key: string;
  label: string;
  sortable: boolean;
  hidden?: boolean;
  align?: "left" | "right" | "center";
}

type DataTableProps = AssertSerializable<{
  table: string;
  rows: Record<string, unknown>[];
  columns: Column[];
  total: number;
  page: number;
  limit: number;
  currentSort?: string;
  currentDir?: string;
}>;

export default function DataTable({
  table,
  rows,
  columns,
  total,
  page,
  limit,
  currentSort,
  currentDir,
}: DataTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [showHidden, setShowHidden] = useState(false);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);

  const visibleColumns = columns.filter((col) => !col.hidden || showHidden);

  const handleSort = (colKey: string, sortable: boolean) => {
    if (!sortable) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");

    if (currentSort === colKey) {
      if (currentDir === "asc") {
        params.set("dir", "desc");
      } else if (currentDir === "desc") {
        params.delete("sort");
        params.delete("dir");
      } else {
        params.set("dir", "asc");
      }
    } else {
      params.set("sort", colKey);
      params.set("dir", "asc");
    }

    router.push(`/admin/db/${table}?${params.toString()}`);
  };

  const totalPages = Math.ceil(total / limit) || 1;

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`/admin/db/${table}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 border border-neutral-200 rounded-lg shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <a href="/admin/db" className="text-xs text-neutral-500 hover:text-neutral-900">
              Tables
            </a>
            <span className="text-neutral-300">/</span>
            <h1 className="text-lg font-bold text-neutral-900 capitalize">{table}</h1>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of{" "}
            {total.toLocaleString()} rows
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`text-xs px-3 py-1.5 rounded-md border font-medium transition ${
              showHidden
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {showHidden ? "Hide Extra Columns" : "Show Extra Columns"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-neutral-200 rounded-lg shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-700 text-xs font-semibold">
                {visibleColumns.map((col) => {
                  const isSorted = currentSort === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key, col.sortable)}
                      className={`px-4 py-3 whitespace-nowrap ${
                        col.sortable ? "cursor-pointer hover:bg-neutral-100 select-none" : ""
                      } ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
                    >
                      <div
                        className={`inline-flex items-center space-x-1 ${
                          col.align === "right"
                            ? "justify-end w-full"
                            : col.align === "center"
                              ? "justify-center w-full"
                              : ""
                        }`}
                      >
                        <span>{col.label}</span>
                        {col.sortable && (
                          <span className="text-neutral-400 text-xs">
                            {isSorted ? (currentDir === "desc" ? "↓" : "↑") : "↕"}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    className="px-4 py-12 text-center text-neutral-500"
                  >
                    No records found in this table.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={(row.id as string | number) ?? idx}
                    onClick={() => setSelectedRow(row)}
                    className="hover:bg-neutral-50 cursor-pointer transition"
                  >
                    {visibleColumns.map((col) => {
                      const rawVal = row[col.key];
                      const displayVal =
                        (row[`_fmt_${col.key}`] as string | undefined) ?? rawVal ?? "—";

                      return (
                        <td
                          key={col.key}
                          className={`px-4 py-3 max-w-xs truncate ${
                            col.align === "right"
                              ? "text-right font-mono text-xs"
                              : col.align === "center"
                                ? "text-center"
                                : "text-left"
                          } ${col.key === "id" ? "font-mono text-xs text-neutral-500" : ""}`}
                        >
                          <span title={typeof rawVal === "string" ? rawVal : undefined}>
                            {displayVal as string}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white border-t border-neutral-200 px-4 py-3 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            Page <span className="font-semibold text-neutral-900">{page}</span> of{" "}
            <span className="font-semibold text-neutral-900">{totalPages}</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs font-medium border border-neutral-300 rounded-md bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs font-medium border border-neutral-300 rounded-md bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedRow && <RowDetail row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </div>
  );
}
