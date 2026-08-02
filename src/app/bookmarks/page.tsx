import ArticleList from "@/app/article-list";
import { getFavoriteArticlesCached } from "@/lib/db";
import Link from "next/link";

export default async function BookmarksPage() {
  const articles = await getFavoriteArticlesCached();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Bookmarks</h1>
          <Link
            href="/"
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            ← Home
          </Link>
        </div>

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
