"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface PaginationProps {
  total: number;
  page: number;
  limit: number;
  table: string;
}

export default function Pagination({ total, page, limit, table }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / limit) || 1;

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`/admin/db/${table}?${params.toString()}`);
  };

  return (
    <div className="bg-white border-t border-neutral-200 px-4 py-3 flex items-center justify-between">
      <div className="text-xs text-neutral-500">
        Showing <span className="font-semibold text-neutral-900">{(page - 1) * limit + 1}</span> to{" "}
        <span className="font-semibold text-neutral-900">{Math.min(page * limit, total)}</span> of{" "}
        <span className="font-semibold text-neutral-900">{total.toLocaleString()}</span> results
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs font-medium border border-neutral-300 rounded-md bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="text-xs text-neutral-600 px-2 font-mono">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs font-medium border border-neutral-300 rounded-md bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
