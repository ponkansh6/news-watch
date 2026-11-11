import { ArticleList } from "@/components/article/article-list";
import { getFavoriteArticlesCached, getLatestPreferenceProfileCached } from "@/lib/db";
import AnalyzeButton from "./analyze-button";
import { PageShell } from "@/components/layout/page-shell";

export default async function BookmarksPage() {
  const [articles, profile] = await Promise.all([
    getFavoriteArticlesCached(),
    getLatestPreferenceProfileCached(),
  ]);

  return (
    <PageShell
      title="ブックマーク"
      description={`${articles.length} 件のお気に入り`}
      actions={
        <AnalyzeButton
          favoriteCount={articles.length}
          lastAnalyzedAt={profile?.createdAt ?? null}
        />
      }
    >
      {profile && (
        <section
          aria-labelledby="profile-heading"
          className="space-y-4 border-y border-border bg-card/50 px-4 py-5 sm:px-6"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="profile-heading" className="text-base font-semibold text-foreground">
              嗜好プロファイル
            </h2>
            <span className="text-xs text-muted-foreground">
              分析日時: {new Date(profile.createdAt).toLocaleString("ja-JP")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{profile.analysis.summary}</p>
          {profile.analysis.themes && profile.analysis.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {profile.analysis.themes.map((theme, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded border px-2 py-0.5 text-xs bg-accent text-accent-foreground border-border"
                >
                  {theme}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-muted-foreground pt-1 border-t border-border flex items-center justify-between">
            <span>
              分析時 {profile.favoriteCount} 件 → 現在 {articles.length} 件
              {profile.favoriteCount !== articles.length && (
                <span className="ml-2 font-medium text-destructive">
                  （変化があります。再分析を推奨）
                </span>
              )}
            </span>
            <span className="text-muted-foreground">モデル: {profile.model}</span>
          </div>
        </section>
      )}

      {articles.length === 0 ? (
        <div className="border-y border-dashed border-border px-6 py-14 text-center">
          <p className="font-medium text-foreground">お気に入りの記事がまだありません</p>
          <p className="mt-2 text-sm text-muted-foreground">
            気になる記事を保存すると、ここから読み返せます。
          </p>
        </div>
      ) : (
        <ArticleList articles={articles} />
      )}
    </PageShell>
  );
}
