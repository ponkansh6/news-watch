import { notFound } from "next/navigation";
import { getTablePage, TableName } from "@/lib/db";
import { TABLE_CONFIG } from "../lib/table-config";
import DataTable from "./components/DataTable";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ page?: string; limit?: string; sort?: string; dir?: string }>;
}) {
  const { table } = await params;
  const { page = "1", limit = "50", sort, dir } = await searchParams;

  const validTables = ["articles", "keyword_embeddings", "favorites"];
  if (!validTables.includes(table)) {
    notFound();
  }

  const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const parsedPage = Math.max(Number(page) || 1, 1);
  const offset = (parsedPage - 1) * parsedLimit;

  const { rows, total } = await getTablePage(table as TableName, {
    offset,
    limit: parsedLimit,
    sort,
    dir: (dir === "asc" ? "asc" : "desc") as any,
  });

  // Pre-format display values on the server
  // (format functions are not serializable across Server → Client boundary)
  const columns = TABLE_CONFIG[table].columns;
  const formattedRows = rows.map((row: Record<string, unknown>) => {
    const enriched = { ...row };
    for (const col of columns) {
      if (col.format) {
        enriched[`_fmt_${col.key}`] = col.format(row[col.key]);
      }
    }
    return enriched;
  });

  // Strip non-serializable format functions from column definitions
  const serializableColumns = columns.map(({ format, ...rest }) => rest);

  return (
    <div className="space-y-6">
      <DataTable
        table={table}
        rows={formattedRows}
        columns={serializableColumns}
        total={total}
        page={parsedPage}
        limit={parsedLimit}
        currentSort={sort}
        currentDir={dir}
      />
    </div>
  );
}
