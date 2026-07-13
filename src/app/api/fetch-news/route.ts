import { NextResponse } from "next/server";
import { KEYWORDS } from "@/lib/config";
import { searchNewsApi, type NewsApiArticle } from "@/lib/news/newsapi";
import { searchQiita, type QiitaArticle } from "@/lib/news/qiita";
import { searchGitHub, type GitHubRepo } from "@/lib/news/github";
import { searchYamadashy, type YamadashyItem } from "@/lib/news/yamadashy";
import { searchITmedia, type ItmediaItem } from "@/lib/news/itmedia";
import { searchCodeZine, type CodeZineItem } from "@/lib/news/codezine";
import { deleteOrphanedArticles, deleteLowScoredArticles, upsertArticle } from "@/lib/db/actions";
import { type NormalizedArticle } from "@/lib/types";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";

// Vercel Hobby = 60s, Pro = 900s
export const maxDuration = 60;

const MAX_ARTICLES = 20;

function normalize(
  article: NewsApiArticle | QiitaArticle | GitHubRepo | YamadashyItem | ItmediaItem | CodeZineItem,
  sourceId: string,
): NormalizedArticle {
  // NewsAPI: .urlToImage, .source.name
  // Qiita: .created_at, no description/urlToImage, sourceName = "Qiita"
  // GitHub: .html_url, .owner.login, sourceName = "GitHub"
  // Yamadashy: .link, .pubDate, sourceName = "Tech Blog"
  // ITmedia: .link, .pubDate, sourceName = "ITmedia"
  // CodeZine: .link, .pubDate, sourceName = "CodeZine"
  const n = article as NewsApiArticle;
  const q = article as QiitaArticle;
  const gh = article as GitHubRepo;
  const yd = article as YamadashyItem;
  const it = article as ItmediaItem;
  const cz = article as CodeZineItem;

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
  } else if ("guid" in it) {
    // ITmedia RSS item
    title = it.title;
    url = it.link;
    publishedAt = it.pubDate ?? new Date().toISOString();
    sourceName = "ITmedia";
    author = null;
  } else if ("guid" in cz) {
    // CodeZine RSS item
    title = cz.title;
    url = cz.link;
    publishedAt = cz.pubDate ?? new Date().toISOString();
    sourceName = "CodeZine";
    author = null;
  } else if ("link" in yd) {
    // Yamadashy RSS item
    title = yd.title;
    url = yd.link ?? "";
    publishedAt = yd.pubDate ?? new Date().toISOString();
    sourceName = "Tech Blog";
    author = yd.author ?? null;
  } else {
    // NewsAPI, Qiita (safe to cast — handled branches above)
    const a = article as NewsApiArticle | QiitaArticle;
    title = a.title;
    url = a.url ?? "";
    publishedAt =
      "publishedAt" in a
        ? a.publishedAt
        : "created_at" in a
          ? a.created_at
          : new Date().toISOString();
    sourceName = "source" in a && a.source?.name ? a.source.name : "user" in a ? "Qiita" : null;
    author = (a as any).author ?? ("user" in a ? (a as any).user.name : null);
  }

  return {
    title,
    description: "description" in article ? (article.description ?? null) : null,
    url,
    urlToImage: n.urlToImage ?? null,
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
    selectedSources = ["newsapi", "qiita", "github", "yamadashy", "itmedia", "codezine"];
  }

  const results: {
    keyword: string;
    fetched: number;
    saved?: number;
    errors: string[];
  }[] = [];

  // Build fetchPromises and sourceOrder for all selected sources
  const fetchPromises: Array<Promise<any>> = [];
  const sourceOrder: string[] = [];

  if (selectedSources.includes("newsapi")) {
    fetchPromises.push(searchNewsApi(20));
    sourceOrder.push("newsapi");
  }
  if (selectedSources.includes("qiita")) {
    fetchPromises.push(searchQiita(20));
    sourceOrder.push("qiita");
  }
  if (selectedSources.includes("github")) {
    fetchPromises.push(searchGitHub(20));
    sourceOrder.push("github");
  }
  if (selectedSources.includes("yamadashy")) {
    fetchPromises.push(searchYamadashy(20));
    sourceOrder.push("yamadashy");
  }
  if (selectedSources.includes("itmedia")) {
    fetchPromises.push(searchITmedia(20));
    sourceOrder.push("itmedia");
  }
  if (selectedSources.includes("codezine")) {
    fetchPromises.push(searchCodeZine(20));
    sourceOrder.push("codezine");
  }

  const fetchedResults = await Promise.all(fetchPromises);

  // Per-source diagnostic breakdown. Kept separate from `results` so the UI's
  // completion accounting (which uses the post-dedupe `all.length`) is unchanged.
  const perSource = sourceOrder.map((source, index) => ({
    source,
    fetched: (fetchedResults[index] ?? []).length,
  }));

  // Normalize + deduplicate + slice to 50 total articles
  const resultsBySource: Record<string, any[]> = {};
  sourceOrder.forEach((source, index) => {
    resultsBySource[source] = fetchedResults[index];
  });

  const all = deduplicate([
    ...(resultsBySource.newsapi ? resultsBySource.newsapi.map((a) => normalize(a, "newsapi")) : []),
    ...(resultsBySource.qiita ? resultsBySource.qiita.map((a) => normalize(a, "qiita")) : []),
    ...(resultsBySource.github ? resultsBySource.github.map((a) => normalize(a, "github")) : []),
    ...(resultsBySource.yamadashy
      ? resultsBySource.yamadashy.map((a) => normalize(a, "yamadashy"))
      : []),
    ...(resultsBySource.itmedia ? resultsBySource.itmedia.map((a) => normalize(a, "itmedia")) : []),
    ...(resultsBySource.codezine
      ? resultsBySource.codezine.map((a) => normalize(a, "codezine"))
      : []),
  ]).slice(0, MAX_ARTICLES);

  // Build a single result with keyword "latest"
  const result = { keyword: "latest", fetched: all.length, errors: [] as string[] } as {
    keyword: string;
    fetched: number;
    saved?: number;
    errors: string[];
  };

  const since = new Date().toISOString();

  if (all.length > 0) {
    try {
      const tagged = await tagArticlesByKeyword(all, KEYWORDS);
      result.saved = await scoreAndSaveTagged(tagged);
    } catch (scoringError) {
      console.error(`[fetch-news] Scoring failed:`, scoringError);
      result.errors.push(`Scoring failed: ${scoringError}`);
    }
  }

  results.push(result);

  // Remove low-scored articles after each batch
  await deleteLowScoredArticles(5, since);

  return NextResponse.json({ ok: true, message: "Scoring queued", results, perSource, since });
}

export async function GET() {
  return NextResponse.json({
    message: "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
