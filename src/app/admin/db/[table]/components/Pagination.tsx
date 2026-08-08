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
    <div className="bg-card border-t border-border px-4 py-3 flex items-center justify-between">
      <div className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{(page - 1) * limit + 1}</span> to{" "}
        <span className="font-semibold text-foreground">{Math.min(page * limit, total)}</span> of{" "}
        <span className="font-semibold text-foreground">{total.toLocaleString()}</span> results
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs font-medium border border-border rounded-md bg-card text-foreground/90 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="text-xs text-muted-foreground px-2 font-mono">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs font-medium border border-border rounded-md bg-card text-foreground/90 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
