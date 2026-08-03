import ArticleList from "@/app/article-list";
import { getFavoriteArticlesCached, getLatestPreferenceProfileCached } from "@/lib/db";
import Link from "next/link";
import AnalyzeButton from "./analyze-button";

export default async function BookmarksPage() {
  const [articles, profile] = await Promise.all([
    getFavoriteArticlesCached(),
    getLatestPreferenceProfileCached(),
  ]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Bookmarks</h1>
          <div className="flex items-center gap-4">
            <AnalyzeButton
              favoriteCount={articles.length}
              lastAnalyzedAt={profile?.createdAt ?? null}
            />
            <Link
              href="/"
              className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              ← Home
            </Link>
          </div>
        </div>

        {profile && (
          <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">嗜好プロファイル</h2>
              <span className="text-xs text-neutral-500">
                分析日時: {new Date(profile.createdAt).toLocaleString("ja-JP")}
              </span>
            </div>
            <p className="text-sm text-neutral-700">{profile.analysis.summary}</p>
            {profile.analysis.themes && profile.analysis.themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {profile.analysis.themes.map((theme, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded border px-2 py-0.5 text-xs bg-blue-50 text-blue-600 border-blue-200"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-100 flex items-center justify-between">
              <span>
                分析時 {profile.favoriteCount} 件 → 現在 {articles.length} 件
                {profile.favoriteCount !== articles.length && (
                  <span className="ml-2 font-medium text-amber-600">
                    （変化があります。再分析を推奨）
                  </span>
                )}
              </span>
              <span className="text-neutral-400">モデル: {profile.model}</span>
            </div>
          </div>
        )}

        {articles.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-12 text-center text-neutral-500">
            No bookmarked articles yet.
          </div>
        ) : (
          <ArticleList articles={articles} />
        )}
      </main>
    </div>
  );
}
