"use client";

interface Article {
  id: number;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  author: string | null;
  keyword: string;
  summary: string | null;
  score: number | null;
  reason: string | null;
  scoredAt: string | null;
  createdAt: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-bold text-neutral-400">
        --
      </span>
    );
  }

  const color =
    score >= 8
      ? "bg-emerald-100 text-emerald-700"
      : score >= 5
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";

  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${color}`}
    >
      {score}
    </span>
  );
}

export default function ArticleList({ articles }: { articles: Article[] }) {
  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <article
          key={article.id}
          className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300"
        >
          <ScoreBadge score={article.score} />

          <div className="min-w-0 flex-1">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-medium leading-snug text-neutral-900 transition-colors hover:text-blue-600"
            >
              {article.title}
            </a>

            {article.summary && (
              <p className="mt-1 text-sm leading-relaxed text-neutral-500 line-clamp-2">
                {article.summary}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              {article.sourceName && (
                <span className="font-medium">{article.sourceName}</span>
              )}
              <time dateTime={article.publishedAt}>
                {formatDate(article.publishedAt)}
              </time>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                {article.keyword}
              </span>
              {article.reason && (
                <span className="italic" title={article.reason}>
                  {article.reason.length > 30
                    ? article.reason.slice(0, 30) + "…"
                    : article.reason}
                </span>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
