import { NextResponse } from "next/server";
import { KEYWORDS } from "@/lib/config";
import { searchNewsApi, type NewsApiArticle } from "@/lib/news/newsapi";
import { searchQiita, type QiitaFeedItem } from "@/lib/news/qiita";
import { searchYamadashy, type YamadashyItem } from "@/lib/news/yamadashy";
import { searchITmedia, type ItmediaItem } from "@/lib/news/itmedia";
import { searchCodeZine, type CodeZineItem } from "@/lib/news/codezine";
import { searchZdnet, type ZdnetItem } from "@/lib/news/zdnet";
import { searchXtech, type XtechItem } from "@/lib/news/xtech";
import { searchHatena, type HatenaItem } from "@/lib/news/hatena";
import { discoverHatenaFeeds } from "@/lib/news/hatena-discovery";
import {
  deleteOrphanedArticles,
  deleteLowScoredArticles,
  upsertArticle,
  refreshRecencyForSources,
} from "@/lib/db/actions";
import { type NormalizedArticle } from "@/lib/types";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";

// Vercel Hobby = 60s, Pro = 900s
export const maxDuration = 60;

export const SUPPORTED_SOURCE_IDS = [
  "newsapi",
  "qiita",
  "yamadashy",
  "itmedia",
  "codezine",
  "zdnet",
  "xtech",
  "hatena",
];

const MAX_ARTICLES = 20;

export function normalize(
  article:
    | NewsApiArticle
    | QiitaFeedItem
    | YamadashyItem
    | ItmediaItem
    | CodeZineItem
    | ZdnetItem
    | XtechItem
    | HatenaItem,
  sourceId: string,
): NormalizedArticle {
  const n = article as NewsApiArticle;

  let sourceName: string | null = null;
  let author: string | null = null;
  let title = "";
  let url = "";
  let publishedAt = "";

  switch (sourceId) {
    case "newsapi": {
      const a = article as NewsApiArticle;
      title = a.title;
      url = a.url ?? "";
      publishedAt = a.publishedAt ?? new Date().toISOString();
      sourceName = a.source?.name ?? null;
      author = a.author ?? null;
      break;
    }
    case "qiita": {
      const q = article as QiitaFeedItem;
      title = q.title;
      url = typeof q.link === "string" ? q.link : q.link["@_href"];
      publishedAt = q.published ?? new Date().toISOString();
      sourceName = "Qiita";
      author = q.author?.name ?? null;
      break;
    }

    case "yamadashy": {
      const yd = article as YamadashyItem;
      title = yd.title;
      url = yd.link ?? "";
      publishedAt = yd.pubDate ?? new Date().toISOString();
      sourceName = "Tech Blog";
      author = yd.author ?? null;
      break;
    }
    case "itmedia": {
      const it = article as ItmediaItem;
      title = it.title;
      url = it.link;
      publishedAt = it.pubDate ?? new Date().toISOString();
      sourceName = "@IT";
      author = null;
      break;
    }
    case "codezine": {
      const cz = article as CodeZineItem;
      title = cz.title;
      url = cz.link;
      publishedAt = cz.pubDate ?? new Date().toISOString();
      sourceName = "CodeZine";
      author = null;
      break;
    }
    case "zdnet": {
      const z = article as ZdnetItem;
      title = z.title;
      url = z.link;
      publishedAt = z.date ?? new Date().toISOString();
      sourceName = "ZDNet Japan";
      author = z.creator ?? null;
      break;
    }
    case "xtech": {
      const x = article as XtechItem;
      title = x.title;
      url = x.link;
      publishedAt = x.date ?? new Date().toISOString();
      sourceName = "日経クロステック";
      author = x.creator ?? null;
      break;
    }
    case "hatena": {
      const h = article as HatenaItem;
      title = h.title;
      url = h.link;
      publishedAt = h.pubDate ?? new Date().toISOString();
      sourceName = "Hatena Blog";
      author = h.author ?? null;
      break;
    }
    default: {
      const a = article as NewsApiArticle;
      title = a.title;
      url = a.url ?? "";
      publishedAt = a.publishedAt ?? new Date().toISOString();
      sourceName = a.source?.name ?? null;
      author = a.author ?? null;
    }
  }

  return {
    title,
    description:
      "description" in article
        ? (article.description ?? null)
        : "content" in article
          ? (article.content ?? null)
          : null,
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
    selectedSources = SUPPORTED_SOURCE_IDS;
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
  if (selectedSources.includes("zdnet")) {
    fetchPromises.push(searchZdnet(20));
    sourceOrder.push("zdnet");
  }
  if (selectedSources.includes("xtech")) {
    fetchPromises.push(searchXtech(20));
    sourceOrder.push("xtech");
  }
  if (selectedSources.includes("hatena")) {
    let hatena = await searchHatena(20);
    if (hatena.length === 0) {
      console.log("[hatena] No active feeds, running discovery...");
      await discoverHatenaFeeds();
      hatena = await searchHatena(20);
    }
    fetchPromises.push(Promise.resolve(hatena));
    sourceOrder.push("hatena");
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

    ...(resultsBySource.yamadashy
      ? resultsBySource.yamadashy.map((a) => normalize(a, "yamadashy"))
      : []),
    ...(resultsBySource.itmedia ? resultsBySource.itmedia.map((a) => normalize(a, "itmedia")) : []),
    ...(resultsBySource.codezine
      ? resultsBySource.codezine.map((a) => normalize(a, "codezine"))
      : []),
    ...(resultsBySource.zdnet ? resultsBySource.zdnet.map((a) => normalize(a, "zdnet")) : []),
    ...(resultsBySource.xtech ? resultsBySource.xtech.map((a) => normalize(a, "xtech")) : []),
    ...(resultsBySource.hatena ? resultsBySource.hatena.map((a) => normalize(a, "hatena")) : []),
  ]).slice(0, MAX_ARTICLES);

  // Build a single result with keyword "latest"
  const result = { keyword: "latest", fetched: all.length, errors: [] as string[] } as {
    keyword: string;
    fetched: number;
    saved?: number;
    errors: string[];
  };

  if (selectedSources.length > 0) {
    try {
      const fetchedUrls = all.map((a) => a.url);
      await refreshRecencyForSources(selectedSources, fetchedUrls);
    } catch (e) {
      console.error(`[fetch-news] Recency refresh failed:`, e);
      result.errors.push(`Recency refresh failed: ${e}`);
    }
  }

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
