import { NextResponse } from "next/server";
import { KEYWORDS } from "@/lib/config";
import { searchGNews, type GNewsArticle } from "@/lib/news/gnews";
import { searchNewsApi, type NewsApiArticle } from "@/lib/news/newsapi";
import { searchHackerNews, type HackerNewsArticle } from "@/lib/news/hackernews";
import { searchQiita, type QiitaArticle } from "@/lib/news/qiita";
import { searchGitHub, type GitHubRepo } from "@/lib/news/github";
import { searchYamadashy, type YamadashyItem } from "@/lib/news/yamadashy";
import { scoreArticles } from "@/lib/llm/gemini";
import type { LLMResponse } from "@/lib/llm/gemini";
import { upsertArticle, deleteOrphanedArticles, deleteLowScoredArticles } from "@/lib/db/actions";

// Vercel Hobby = 60s, Pro = 900s
export const maxDuration = 60;

const MAX_ARTICLES_PER_KEYWORD = 15;

/* ---------- normalize differences between GNews / NewsAPI ---------- */

interface NormalizedArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  sourceName: string | null;
  sourceId: string;
  author: string | null;
}

function normalize(
  article:
    | GNewsArticle
    | NewsApiArticle
    | HackerNewsArticle
    | QiitaArticle
    | GitHubRepo
    | YamadashyItem,
  sourceId: string,
): NormalizedArticle {
  // GNews: .image, .source.name+.url
  // NewsAPI: .urlToImage, .source.name
  // HackerNews: .story_text, .sourceName = "Hacker News"
  // Qiita: .created_at, no description/urlToImage, sourceName = "Qiita"
  // GitHub: .html_url, .owner.login, sourceName = "GitHub"
  // Yamadashy: .link, .pubDate, sourceName = "Tech Blog"
  const g = article as GNewsArticle;
  const n = article as NewsApiArticle;
  const hn = article as HackerNewsArticle;
  const q = article as QiitaArticle;
  const gh = article as GitHubRepo;
  const yd = article as YamadashyItem;

  // Determine source name
  let sourceName: string | null = null;
  let author: string | null = null;
  let title = "";
  let url = "";
  let publishedAt = "";

  if ("name" in gh) {
    // GitHub repo
    title = gh.name;
    url = gh.html_url;
    publishedAt = gh.created_at;
    sourceName = "GitHub";
    author = gh.owner.login;
  } else if ("link" in yd) {
    // Yamadashy RSS item
    title = yd.title;
    url = yd.link ?? "";
    publishedAt = yd.pubDate ?? new Date().toISOString();
    sourceName = "Tech Blog";
    author = yd.author ?? null;
  } else {
    // GNews, NewsAPI, HackerNews, Qiita (safe to cast — handled branches above)
    const a = article as GNewsArticle | NewsApiArticle | HackerNewsArticle | QiitaArticle;
    title = a.title;
    url = a.url ?? "";
    publishedAt =
      "publishedAt" in a ? a.publishedAt : "created_at" in a ? a.created_at : hn.created_at;
    sourceName =
      "source" in a && a.source?.name ? a.source.name : "user" in a ? "Qiita" : "Hacker News";
    author = (a as any).author ?? hn.author ?? ("user" in a ? a.user.name : null);
  }

  return {
    title,
    description: "description" in article ? (article.description ?? null) : null,
    url,
    urlToImage: g.image ?? n.urlToImage ?? null,
    publishedAt,
    sourceName,
    sourceId,
    author,
  };
}

/* ---------- deduplicate by normalised URL ---------- */

function deduplicate(articles: NormalizedArticle[]): NormalizedArticle[] {
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

/* ---------- recency score (algorithmic, 0-10) ---------- */

function calcRecencyScore(publishedAt: string): number {
  const now = Date.now();
  const pub = new Date(publishedAt).getTime();
  const days = (now - pub) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  if (days <= 30) return 2;
  return 0;
}

/* ---------- score & save one article ---------- */

async function scoreAndSave(
  article: NormalizedArticle,
  keyword: string,
  llmResult: LLMResponse | null,
): Promise<boolean> {
  const relevance = llmResult?.relevance ?? 5;
  const usefulness = llmResult?.usefulness ?? 5;
  const recency = calcRecencyScore(article.publishedAt);
  // composite = relevance(30%) + usefulness(40%) + recency(30%)
  const composite = Math.round((relevance * 0.3 + usefulness * 0.4 + recency * 0.3) * 10) / 10;

  await upsertArticle({
    title: article.title,
    description: article.description,
    url: article.url,
    urlToImage: article.urlToImage,
    publishedAt: article.publishedAt,
    sourceName: article.sourceName,
    sourceId: article.sourceId,
    author: article.author,
    keyword,
    summary: llmResult?.summary ?? null,
    relevance,
    usefulness,
    recency,
    // composite score stored in `score` field (backward-compatible)
    score: composite,
    reason: llmResult?.reason ?? null,
    scoredAt: llmResult ? new Date().toISOString() : null,
  });

  return llmResult !== null;
}

/* ---------- POST handler ---------- */

export async function POST(request: Request) {
  // Remove articles for keywords no longer in config
  await deleteOrphanedArticles([...KEYWORDS]);

  // Parse request body to get selected sources
  let selectedSources: string[] = [];
  try {
    const body = await request.json();
    selectedSources = body.sources || [];
  } catch {
    // If parsing fails or no sources provided, default to all sources
    selectedSources = ["gnews", "newsapi", "hackernews", "qiita", "github", "yamadashy"];
  }

  const results: {
    keyword: string;
    fetched: number;
    scored: number;
    errors: string[];
  }[] = [];

  for (const keyword of KEYWORDS) {
    const result = { keyword, fetched: 0, scored: 0, errors: [] as string[] };

    try {
      // 1. Fetch from selected sources only
      const fetchPromises: Array<Promise<any>> = [];
      const sourceOrder: string[] = [];

      if (selectedSources.includes("gnews")) {
        fetchPromises.push(searchGNews(keyword));
        sourceOrder.push("gnews");
      }
      if (selectedSources.includes("newsapi")) {
        fetchPromises.push(searchNewsApi(keyword));
        sourceOrder.push("newsapi");
      }
      if (selectedSources.includes("hackernews")) {
        fetchPromises.push(searchHackerNews(keyword));
        sourceOrder.push("hackernews");
      }
      if (selectedSources.includes("qiita")) {
        fetchPromises.push(searchQiita(keyword));
        sourceOrder.push("qiita");
      }
      if (selectedSources.includes("github")) {
        fetchPromises.push(searchGitHub(keyword));
        sourceOrder.push("github");
      }
      if (selectedSources.includes("yamadashy")) {
        fetchPromises.push(searchYamadashy(keyword));
        sourceOrder.push("yamadashy");
      }

      const fetchedResults = await Promise.all(fetchPromises);

      // 2. Normalise + deduplicate + limit
      // Map results by source name to avoid index mismatch
      const resultsBySource: Record<string, any[]> = {};
      sourceOrder.forEach((source, index) => {
        resultsBySource[source] = fetchedResults[index];
      });

      // HN self-posts (Ask HN / Show HN) may have url=null → filter them out
      const all = deduplicate([
        ...(resultsBySource.gnews ? resultsBySource.gnews.map((a) => normalize(a, "gnews")) : []),
        ...(resultsBySource.newsapi
          ? resultsBySource.newsapi.map((a) => normalize(a, "newsapi"))
          : []),
        ...(resultsBySource.hackernews
          ? resultsBySource.hackernews.map((a) => normalize(a, "hackernews")).filter((a) => a.url)
          : []),
        ...(resultsBySource.qiita ? resultsBySource.qiita.map((a) => normalize(a, "qiita")) : []),
        ...(resultsBySource.github
          ? resultsBySource.github.map((a) => normalize(a, "github"))
          : []),
        ...(resultsBySource.yamadashy
          ? resultsBySource.yamadashy.map((a) => normalize(a, "yamadashy"))
          : []),
      ]).slice(0, MAX_ARTICLES_PER_KEYWORD);

      result.fetched = all.length;

      // 3. Batch score: one LLM call per keyword
      const llmResults = await scoreArticles(
        all.map((a) => ({ title: a.title, description: a.description })),
        keyword,
      );

      let scoredCount = 0;
      for (let i = 0; i < all.length; i++) {
        const llmResult = llmResults[i] ?? null;
        const saved = await scoreAndSave(all[i], keyword, llmResult);
        if (saved) scoredCount++;
      }
      result.scored = scoredCount;
    } catch (err) {
      result.errors.push(String(err));
    }

    results.push(result);
  }

  // Remove low-scored articles after each batch
  await deleteLowScoredArticles(5);

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return NextResponse.json({
    message: "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
