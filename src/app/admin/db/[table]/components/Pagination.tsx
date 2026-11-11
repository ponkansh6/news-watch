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
    <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{(page - 1) * limit + 1}</span> to{" "}
        <span className="font-semibold text-foreground">{Math.min(page * limit, total)}</span> of{" "}
        <span className="font-semibold text-foreground">{total.toLocaleString()}</span> results
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="h-10 border border-border bg-card px-3 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-xs text-muted-foreground px-2 font-mono">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          className="h-10 border border-border bg-card px-3 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
