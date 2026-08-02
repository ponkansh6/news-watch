import Link from "next/link";
import { getTableCounts } from "@/lib/db";

export const dynamic = "force-dynamic";

const TABLE_DESCRIPTIONS: Record<string, { name: string; desc: string }> = {
  articles: {
    name: "Articles",
    desc: "Fetched news articles, scoring details, summaries, and embeddings.",
  },
  keyword_embeddings: {
    name: "Keyword Embeddings",
    desc: "Precomputed vector embeddings for keywords used in similarity search.",
  },
  favorites: {
    name: "Favorites",
    desc: "Hidden bookmarks for favorite articles (unofficial feature).",
  },
};

export default async function AdminDbLandingPage() {
  const counts = await getTableCounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Database Viewer</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Select a table to inspect raw records, review counts, and browse database state.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(TABLE_DESCRIPTIONS).map(([key, info]) => {
          const count = counts[key as keyof typeof counts] ?? 0;
          return (
            <Link
              key={key}
              href={`/admin/db/${key}`}
              className="bg-white border border-neutral-200 rounded-lg p-6 shadow-xs hover:border-neutral-400 hover:shadow-sm transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-neutral-900">{info.name}</h2>
                  <span className="font-mono text-xs bg-neutral-100 text-neutral-700 px-2.5 py-1 rounded-full">
                    {key}
                  </span>
                </div>
                <p className="text-sm text-neutral-600 mt-3">{info.desc}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between">
                <span className="text-xs text-neutral-500 font-medium">Total Rows</span>
                <span className="font-mono font-bold text-neutral-900 text-base">
                  {count.toLocaleString()}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
