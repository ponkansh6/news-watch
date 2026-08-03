export interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  hidden?: boolean; // hidden by default (like embedding)
  format?: (value: any) => string; // optional formatter
  align?: "left" | "right" | "center";
}

export const TABLE_CONFIG: Record<string, { columns: ColumnDef[] }> = {
  articles: {
    columns: [
      { key: "id", label: "ID", sortable: true, align: "right" },
      { key: "title", label: "Title", sortable: true },
      { key: "sourceName", label: "Source", sortable: true },
      { key: "sourceId", label: "Source ID", sortable: true },
      { key: "keyword", label: "Keyword", sortable: true },
      {
        key: "score",
        label: "Score",
        sortable: true,
        align: "right",
        format: (v) => v?.toFixed(2) ?? "—",
      },
      { key: "relevance", label: "Relv", sortable: true, align: "right" },
      { key: "usefulness", label: "Usef", sortable: true, align: "right" },
      { key: "recency", label: "Rec", sortable: true, align: "right" },
      {
        key: "publishedAt",
        label: "Published",
        sortable: true,
        format: (v) => (v ? new Date(v).toLocaleDateString("ja-JP") : "—"),
      },
      {
        key: "createdAt",
        label: "Created",
        sortable: true,
        format: (v) => (v ? new Date(v).toLocaleDateString("ja-JP") : "—"),
      },
      { key: "author", label: "Author", sortable: false, hidden: true },
      { key: "summary", label: "Summary", sortable: false, hidden: true },
      { key: "reason", label: "Reason", sortable: false, hidden: true },
      { key: "url", label: "URL", sortable: false, hidden: true },
      { key: "embedding", label: "Embedding", sortable: false, hidden: true },
    ],
  },
  keyword_embeddings: {
    columns: [
      { key: "id", label: "ID", sortable: true, align: "right" },
      { key: "keyword", label: "Keyword", sortable: true },
      { key: "model", label: "Model", sortable: true },
      { key: "dimensions", label: "Dim", sortable: true, align: "right" },
      {
        key: "createdAt",
        label: "Created",
        sortable: true,
        format: (v) => (v ? new Date(v).toLocaleDateString("ja-JP") : "—"),
      },
      { key: "embedding", label: "Embedding", sortable: false, hidden: true },
    ],
  },
  favorites: {
    columns: [
      { key: "id", label: "ID", sortable: true, align: "right" },
      { key: "articleId", label: "Article ID", sortable: true, align: "right" },
      {
        key: "createdAt",
        label: "Favorited At",
        sortable: true,
        format: (v) => (v ? new Date(v).toLocaleString("ja-JP") : "—"),
      },
    ],
  },
  preference_profiles: {
    columns: [
      { key: "id", label: "ID", sortable: true, align: "right" },
      { key: "version", label: "Version", sortable: true, align: "right" },
      { key: "favoriteCount", label: "Fav Count", sortable: true, align: "right" },
      { key: "favoriteMaxId", label: "Fav Max ID", sortable: true, align: "right" },
      { key: "model", label: "Model", sortable: true },
      { key: "analysis", label: "Analysis", sortable: false, hidden: true },
      { key: "promptSection", label: "Prompt Section", sortable: false, hidden: true },
      {
        key: "createdAt",
        label: "Created",
        sortable: true,
        format: (v) => (v ? new Date(v).toLocaleString("ja-JP") : "—"),
      },
    ],
  },
};

// Helper to get sortable column keys for a table
export function getAllowedSortColumns(table: string): string[] {
  return TABLE_CONFIG[table]?.columns.filter((c) => c.sortable).map((c) => c.key) ?? ["id"];
}
