import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "crypto";
import { SOURCE_IDS, getSourceAdapter, normalizeUnknownSource } from "@/lib/news/registry";
import { FetchNewsBodySchema } from "./schema";
import { cleanupOrphaned, refreshRecency, cleanupLowScored } from "./pipeline/maintenance";
import { type NormalizedArticle } from "@/lib/types";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";

// Vercel Hobby = 60s, Pro = 900s
export const maxDuration = 60;

export const SUPPORTED_SOURCE_IDS = SOURCE_IDS;

const MAX_ARTICLES = 20;
const FETCH_LIMIT = 20;

export function normalize(article: unknown, sourceId: string): NormalizedArticle {
  const adapter = getSourceAdapter(sourceId);
  return adapter ? adapter.toArticle(article, sourceId) : normalizeUnknownSource(article, sourceId);
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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid authorization" }, { status: 401 });
    }
    const token = auth.slice(7);
    const secretBuf = Buffer.from(cronSecret);
    const tokenBuf = Buffer.from(token);
    if (secretBuf.length !== tokenBuf.length || !timingSafeEqual(secretBuf, tokenBuf)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await cleanupOrphaned();

  const rawBody = await request.json().catch(() => ({}));
  const parsed = FetchNewsBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid source", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const selectedSource = parsed.data.source;
  const adapter = getSourceAdapter(selectedSource)!;

  const raw = await adapter.fetch(FETCH_LIMIT);
  const all = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id))).slice(
    0,
    MAX_ARTICLES,
  );
  const perSource = [{ source: adapter.id, fetched: raw.length }];

  const result = { keyword: "latest", fetched: all.length, errors: [] as string[] } as {
    keyword: string;
    fetched: number;
    saved?: number;
    errors: string[];
  };

  await refreshRecency(selectedSource, all, result);

  const since = new Date().toISOString();

  if (all.length > 0) {
    try {
      result.saved = await scoreAndSaveTagged(all);
    } catch (scoringError) {
      console.error(`[fetch-news] Scoring failed:`, scoringError);
      result.errors.push(`Scoring failed: ${scoringError}`);
    }
  }

  const results = [result];
  await cleanupLowScored(since);
  revalidateTag("articles", "max");

  return NextResponse.json({ ok: true, message: "Scoring queued", results, perSource, since });
}

export async function GET() {
  return NextResponse.json({
    message: "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
