import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { KEYWORDS } from "@/lib/config";
import { searchGNews, type GNewsArticle } from "@/lib/news/gnews";
import { searchNewsApi, type NewsApiArticle } from "@/lib/news/newsapi";
import { searchHackerNews, type HackerNewsArticle } from "@/lib/news/hackernews";
import { searchQiita, type QiitaArticle } from "@/lib/news/qiita";
import { searchGitHub, type GitHubRepo } from "@/lib/news/github";
import { searchYamadashy, type YamadashyItem } from "@/lib/news/yamadashy";
import { scoreArticle } from "@/lib/llm/openrouter";
import { upsertArticle, deleteOrphanedArticles, deleteLowScoredArticles } from "@/lib/db/actions";

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

function normalize(article: GNewsArticle | NewsApiArticle | HackerNewsArticle | QiitaArticle | GitHubRepo | YamadashyItem): NormalizedArticle {
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
    publishedAt = "publishedAt" in a ? a.publishedAt : ("created_at" in a ? a.created_at : hn.created_at);
    sourceName = "source" in a && a.source?.name ? a.source.name : ("user" in a ? "Qiita" : "Hacker News");
    author = (a as any).author ?? hn.author ?? ("user" in a ? a.user.name : null);
  }
  
  return {
    title,
    description:
      "description" in article ? (article.description ?? null) : null,
    url,
    urlToImage: g.image ?? n.urlToImage ?? null,
    publishedAt,
    sourceName,
    author,
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
): Promise<boolean> {
  const llmResult = await scoreArticle(
    { title: article.title, description: article.description },
    keyword,
  );

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
      const fetchPromises = [];
      
      if (selectedSources.includes("gnews")) fetchPromises.push(searchGNews(keyword));
      if (selectedSources.includes("newsapi")) fetchPromises.push(searchNewsApi(keyword));
      if (selectedSources.includes("hackernews")) fetchPromises.push(searchHackerNews(keyword));
      if (selectedSources.includes("qiita")) fetchPromises.push(searchQiita(keyword));
      if (selectedSources.includes("github")) fetchPromises.push(searchGitHub(keyword));
      if (selectedSources.includes("yamadashy")) fetchPromises.push(searchYamadashy(keyword));

      const fetchedResults = await Promise.all(fetchPromises);

      // 2. Normalise + deduplicate + limit
      // HN self-posts (Ask HN / Show HN) may have url=null → filter them out
      const all = deduplicate([
        ...(selectedSources.includes("gnews") ? fetchedResults[0].map(normalize) : []),
        ...(selectedSources.includes("newsapi") ? fetchedResults[1].map(normalize) : []),
        ...(selectedSources.includes("hackernews") ? fetchedResults[2].map(normalize).filter((a) => a.url) : []),
        ...(selectedSources.includes("qiita") ? fetchedResults[3].map(normalize) : []),
        ...(selectedSources.includes("github") ? fetchedResults[4].map(normalize) : []),
        ...(selectedSources.includes("yamadashy") ? fetchedResults[5].map(normalize) : []),
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

  // Remove low-scored articles after each batch
  await deleteLowScoredArticles(5);

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return NextResponse.json({
    message:
      "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
