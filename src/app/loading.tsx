import { SkeletonList } from "./article-list";

export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">News Watch</h1>
        <p className="mt-1 text-neutral-500">
          監視キーワード: Anthropic, OpenAI, ソフトバンク, KDDI, ドコモビジネス
        </p>
      </header>

      <section className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            スコアリング済み記事
            <span className="ml-2 text-sm font-normal text-neutral-400">(読み込み中...)</span>
          </h2>
        </div>

        <SkeletonList count={5} />
      </section>

      <section className="mb-12">
        <div className="flex items-center justify-center p-8">
          <div className="text-neutral-400">データを読み込んでいます...</div>
        </div>
      </section>

      <section className="border-t border-neutral-200 pt-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-400">最終更新: --</h2>
      </section>
    </main>
  );
}
