import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "crypto";
import { SOURCE_IDS, getSourceAdapter, normalizeUnknownSource } from "@/lib/news/registry";
import { FetchNewsBodySchema } from "./schema";
import { cleanupOrphaned, refreshRecency, gcStaleArticles } from "./pipeline/maintenance";
import { selectForScoring } from "./pipeline/select";
import { type NormalizedArticle } from "@/lib/types";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { getLatestPreferenceProfile } from "@/lib/db";
import { buildPreferencePromptSection } from "@/lib/llm";
import { computeScoringSignature } from "@/lib/scoring-signature";
import { SCORING_BUDGET } from "@/lib/constants";

export const maxDuration = 60;
export const SUPPORTED_SOURCE_IDS = SOURCE_IDS;

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

  // 嗜好プロファイルは選抜とスコアリングの両方が必要 → ここで一度だけ読む
  const profile = await getLatestPreferenceProfile();
  const preferenceSection = buildPreferencePromptSection(profile?.analysis ?? null);
  const signature = computeScoringSignature(preferenceSection);

  const raw = await adapter.fetch(); // 上限なし
  const all = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id))); // 冗長 slice 削除
  const perSource = [{ source: adapter.id, fetched: raw.length }];

  const selection = await selectForScoring(all, signature, SCORING_BUDGET);

  const result = {
    keyword: "latest",
    fetched: all.length, // 重複排除後の取得件数
    candidates: all.length, // 候補プール全体
    saved: undefined as number | undefined,
    scored: selection.toScore.length, // LLM に送る件数
    skipped: selection.skipped.length,
    deferred: selection.deferred.length,
    errors: [] as string[],
  };

  await refreshRecency(
    selectedSource,
    selection.toScore.map((a) => a.url),
    result,
  );

  if (selection.toScore.length > 0) {
    try {
      result.saved = await scoreAndSaveTagged(selection.toScore, { preferenceSection, signature });
    } catch (scoringError) {
      console.error(`[fetch-news] Scoring failed:`, scoringError);
      result.errors.push(`Scoring failed: ${scoringError}`);
    }
  }

  await gcStaleArticles();
  revalidateTag("articles", "max");

  return NextResponse.json({ ok: true, message: "Scoring queued", results: [result], perSource });
}

export async function GET() {
  return NextResponse.json({
    message: "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
