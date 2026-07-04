import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { KEYWORDS } from "@/lib/config";
import { searchGNews, type GNewsArticle } from "@/lib/news/gnews";
import { searchNewsApi, type NewsApiArticle } from "@/lib/news/newsapi";
import { scoreArticle } from "@/lib/llm/openrouter";
import { upsertArticle } from "@/lib/db/actions";

// Vercel Hobby = 60s, Pro = 900s
export const maxDuration = 60;

const MAX_ARTICLES_PER_KEYWORD = 15;
const LLM_CONCURRENCY = 3;

/* ---------- normalize differences between GNews / NewsAPI ---------- */

interface NormalizedArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  author: string | null;
}

function normalize(article: GNewsArticle | NewsApiArticle): NormalizedArticle {
  // GNews: .image, .source.name+.url
  // NewsAPI: .urlToImage, .source.name
  const g = article as GNewsArticle;
  const n = article as NewsApiArticle;
  return {
    title: article.title,
    description:
      "description" in article ? (article.description ?? null) : null,
    url: article.url,
    urlToImage: g.image ?? n.urlToImage ?? null,
    publishedAt: article.publishedAt,
    sourceName: article.source?.name ?? null,
    author: (article as any).author ?? null,
  };
}

/* ---------- deduplicate by normalised URL ---------- */

function deduplicate(
  articles: NormalizedArticle[],
): NormalizedArticle[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    try {
      const key = new URL(a.url).href.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      // unparseable URL – keep but dedup by raw string
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    }
  });
}

/* ---------- score & save one article ---------- */

async function scoreAndSave(
  article: NormalizedArticle,
  keyword: string,
): Promise<boolean> {
  const llmResult = await scoreArticle(
    { title: article.title, description: article.description },
    keyword,
  );

  await upsertArticle({
    title: article.title,
    description: article.description,
    url: article.url,
    urlToImage: article.urlToImage,
    publishedAt: article.publishedAt,
    sourceName: article.sourceName,
    author: article.author,
    keyword,
    summary: llmResult?.summary ?? null,
    score: llmResult?.score ?? null,
    reason: llmResult?.reason ?? null,
    scoredAt: llmResult ? new Date().toISOString() : null,
  });

  return llmResult !== null;
}

/* ---------- POST handler ---------- */

export async function POST() {
  const results: {
    keyword: string;
    fetched: number;
    scored: number;
    errors: string[];
  }[] = [];

  for (const keyword of KEYWORDS) {
    const result = { keyword, fetched: 0, scored: 0, errors: [] as string[] };

    try {
      // 1. Fetch from both APIs
      const [gnewsRaw, newsApiRaw] = await Promise.all([
        searchGNews(keyword),
        searchNewsApi(keyword),
      ]);

      // 2. Normalise + deduplicate + limit
      const all = deduplicate([
        ...gnewsRaw.map(normalize),
        ...newsApiRaw.map(normalize),
      ]).slice(0, MAX_ARTICLES_PER_KEYWORD);

      result.fetched = all.length;

      // 3. Score with limited concurrency
      const limit = pLimit(LLM_CONCURRENCY);
      const scoreResults = await Promise.all(
        all.map((a) => limit(() => scoreAndSave(a, keyword))),
      );

      result.scored = scoreResults.filter(Boolean).length;
    } catch (err) {
      result.errors.push(String(err));
    }

    results.push(result);
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return NextResponse.json({
    message:
      "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
