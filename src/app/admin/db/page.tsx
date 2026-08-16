import Link from "next/link";
import { getTableCounts } from "@/lib/db";
import { PageShell } from "@/components/layout/page-shell";

export const dynamic = "force-dynamic";

const TABLE_DESCRIPTIONS: Record<string, { name: string; desc: string }> = {
  articles: {
    name: "Articles",
    desc: "Fetched news articles, scoring details, summaries, and evaluation reasons.",
  },
  favorites: {
    name: "Favorites",
    desc: "Hidden bookmarks for favorite articles (unofficial feature).",
  },
  not_for_me: {
    name: "Not For Me",
    desc: "Articles explicitly marked as 'not for me' by the user (5 consecutive title swipes, unofficial feature).",
  },
  preference_profiles: {
    name: "Preference Profiles",
    desc: "User preference profiles extracted from favorites by LLM (append-only history).",
  },
};

export default async function AdminDbLandingPage() {
  const counts = await getTableCounts();

  return (
    <PageShell
      width="wide"
      title="Database Viewer"
      description="Select a table to inspect raw records, review counts, and browse database state."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(TABLE_DESCRIPTIONS).map(([key, info]) => {
          const count = counts[key as keyof typeof counts] ?? 0;
          return (
            <Link
              key={key}
              href={`/admin/db/${key}`}
              className="bg-card border border-border rounded-lg p-6 shadow-xs hover:border-muted-foreground hover:shadow-sm transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">{info.name}</h2>
                  <span className="font-mono text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full">
                    {key}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-3">{info.desc}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Total Rows</span>
                <span className="font-mono font-bold text-foreground text-base">
                  {count.toLocaleString()}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}
