import { getScoredArticles, getAllArticles } from "@/lib/db/actions";
import { KEYWORDS } from "@/lib/config";
import ArticleList from "./article-list";

export const dynamic = "force-dynamic";

export default async function Home() {
  const scored = await getScoredArticles(100);
  const all = await getAllArticles(100);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">News Watch</h1>
        <p className="mt-1 text-neutral-500">
          監視キーワード: {KEYWORDS.join(", ")}
        </p>
      </header>

      <section className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            スコアリング済み記事
            <span className="ml-2 text-sm font-normal text-neutral-400">
              ({scored.length}件)
            </span>
          </h2>
        </div>

        {scored.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center text-neutral-400">
            <p className="mb-2 text-lg">まだ記事がありません</p>
            <p className="text-sm">
              「ニュースを取得」ボタンで最新ニュースを取得・スコアリングできます
            </p>
          </div>
        ) : (
          <ArticleList articles={scored} />
        )}
      </section>

      {/* fetch button using a form */}
      <section className="mb-12">
        <form
          action="/api/fetch-news"
          method="POST"
          className="flex items-center gap-3"
        >
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            ニュースを取得してスコアリング
          </button>
          <span className="text-xs text-neutral-400">
            GNews / NewsAPI から取得 → LLMでスコアリング
          </span>
        </form>
      </section>

      {all.length > 0 && (
        <section className="border-t border-neutral-200 pt-8">
          <h2 className="mb-2 text-sm font-medium text-neutral-400">
            最終更新: {all[0]?.createdAt ?? "N/A"}
          </h2>
        </section>
      )}
    </main>
  );
}
