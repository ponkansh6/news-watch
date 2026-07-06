"use client";

interface Article {
  id: number;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string | null;
  author: string | null;
  keyword: string;
  summary: string | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
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

function ScoreBadge({
  score,
  relevance,
  usefulness,
  recency,
}: {
  score: number | null;
  relevance: number | null;
  usefulness: number | null;
  recency: number | null;
}) {
  if (score === null) {
    return (
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-bold text-neutral-400">
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
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${color}`}
      title={`関連性: ${relevance?.toFixed(1) || "N/A"} (30%)\n有用性: ${usefulness?.toFixed(1) || "N/A"} (40%)\n新しさ: ${recency?.toFixed(1) || "N/A"} (30%)\n━━━━━━━━━━━━━━━\n合成: ${score.toFixed(1)}`}
    >
      {score}
    </span>
  );
}

function NewspaperIcon() {
  return (
    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  );
}

function getKeywordColor(keyword: string): string {
  const colors = [
    "bg-rose-50 text-rose-600 border-rose-200",
    "bg-blue-50 text-blue-600 border-blue-200",
    "bg-green-50 text-green-600 border-green-200",
    "bg-purple-50 text-purple-600 border-purple-200",
    "bg-orange-50 text-orange-600 border-orange-200",
    "bg-teal-50 text-teal-600 border-teal-200",
    "bg-indigo-50 text-indigo-600 border-indigo-200",
    "bg-pink-50 text-pink-600 border-pink-200",
  ];

  let hash = 0;
  for (let i = 0; i < keyword.length; i++) {
    hash = keyword.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export default function ArticleList({ articles }: { articles: Article[] }) {
  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <article
          key={article.id}
          className="group flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4 transition-all duration-200 hover:shadow-sm hover:border-neutral-300"
        >
          {article.urlToImage ? (
            <img
              src={article.urlToImage}
              alt={article.title}
              className="h-[120px] w-[120px] shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="h-[120px] w-[120px] shrink-0 rounded-lg bg-neutral-100 flex items-center justify-center">
              <NewspaperIcon />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-semibold leading-snug text-neutral-900 transition-colors hover:text-blue-600 text-base"
            >
              {article.title}
            </a>

            {article.summary && (
              <p className="mt-1 text-sm leading-relaxed text-neutral-500 line-clamp-2">
                {article.summary}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {article.sourceName && (
                <span className="font-medium text-neutral-600">{article.sourceName}</span>
              )}
              <time dateTime={article.publishedAt} className="text-neutral-500">
                {formatDate(article.publishedAt)}
              </time>
              <span className={`rounded border px-2 py-0.5 ${getKeywordColor(article.keyword)}`}>
                {article.keyword}
              </span>
              {article.reason && (
                <span className="italic text-neutral-400" title={article.reason}>
                  {article.reason.length > 30 ? article.reason.slice(0, 30) + "…" : article.reason}
                </span>
              )}
            </div>
          </div>

          <div className="ml-4">
            <ScoreBadge
              score={article.score}
              relevance={article.relevance}
              usefulness={article.usefulness}
              recency={article.recency}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <article className="group flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="h-[120px] w-[120px] shrink-0 rounded-lg bg-neutral-200 animate-pulse" />

      <div className="min-w-0 flex-1">
        <div className="h-4 w-3/4 rounded bg-neutral-200 animate-pulse mb-2" />
        <div className="h-3 w-full rounded bg-neutral-200 animate-pulse mb-1" />
        <div className="h-3 w-5/6 rounded bg-neutral-200 animate-pulse mb-3" />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="h-3 w-16 rounded bg-neutral-200 animate-pulse" />
          <div className="h-3 w-20 rounded bg-neutral-200 animate-pulse" />
          <div className="h-3 w-12 rounded bg-neutral-200 animate-pulse" />
        </div>
      </div>

      <div className="ml-4">
        <div className="h-12 w-12 rounded-lg bg-neutral-200 animate-pulse" />
      </div>
    </article>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
