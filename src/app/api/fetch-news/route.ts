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
import { issueArticlesInvalidationToken } from "@/lib/cache-invalidation-token";

export const maxDuration = 60;
export const SUPPORTED_SOURCE_IDS = SOURCE_IDS;

export function normalize(article: unknown, sourceId: string): NormalizedArticle {
  const adapter = getSourceAdapter(sourceId);
  return adapter ? adapter.toArticle(article, sourceId) : normalizeUnknownSource(article, sourceId);
}

type FetchProgress = {
  stage: "fetching" | "selecting" | "scoring" | "cleanup" | "complete";
  completed: number;
  total: number;
  failed: number;
};

async function executeFetch(
  selectedSource: string,
  onProgress?: (progress: FetchProgress) => void,
  invalidateArticleCache = true,
) {
  await cleanupOrphaned();
  onProgress?.({ stage: "fetching", completed: 0, total: 0, failed: 0 });
  const adapter = getSourceAdapter(selectedSource)!;

  const profile = await getLatestPreferenceProfile();
  const preferenceSection = buildPreferencePromptSection(profile?.analysis ?? null);
  const signature = computeScoringSignature(preferenceSection);

  const raw = await adapter.fetch();
  const all = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id)));
  const perSource = [{ source: adapter.id, fetched: raw.length }];

  onProgress?.({ stage: "selecting", completed: 0, total: 0, failed: 0 });
  const selection = await selectForScoring(all, signature, SCORING_BUDGET);
  const result = {
    keyword: "latest",
    fetched: all.length,
    candidates: all.length,
    saved: undefined as number | undefined,
    scored: selection.toScore.length,
    skipped: selection.skipped.length,
    deferred: selection.deferred.length,
    errors: [] as string[],
    scoringErrors: [] as string[],
  };

  await refreshRecency(
    selectedSource,
    selection.toScore.map((a) => a.url),
    result,
  );

  let completedScoring = 0;
  let failedScoring = 0;
  if (selection.toScore.length > 0) {
    let scoringFailed = false;
    let scoredCount = 0;
    onProgress?.({ stage: "scoring", completed: 0, total: selection.toScore.length, failed: 0 });
    try {
      result.saved = await scoreAndSaveTagged(selection.toScore, {
        preferenceSection,
        signature,
        onScoringError: () => {
          scoringFailed = true;
        },
        onScoringSuccess: () => {
          scoredCount++;
        },
        onScoringProgress: (completed, failed, total) => {
          completedScoring = completed;
          failedScoring = failed;
          onProgress?.({ stage: "scoring", completed, failed, total });
        },
      });
    } catch (scoringError) {
      console.error(`[fetch-news] Scoring failed:`, scoringError);
      scoringFailed = true;
    }

    if (scoringFailed && scoredCount === 0) {
      const message = "採点サービスでエラーが発生しました。時間をおいて再試行してください。";
      result.scoringErrors.push(message);
      result.errors.push(`Scoring failed: ${message}`);
    }
  }

  onProgress?.({
    stage: "cleanup",
    completed: completedScoring,
    total: selection.toScore.length,
    failed: failedScoring,
  });
  await gcStaleArticles();
  if (invalidateArticleCache) revalidateTag("articles", { expire: 0 });
  const response = { ok: true as const, message: "Scoring queued", results: [result], perSource };
  onProgress?.({
    stage: "complete",
    completed: completedScoring,
    total: selection.toScore.length,
    failed: failedScoring,
  });
  return response;
}

function isAuthorized(request: Request): boolean {
  const bearerSecret = process.env.CRON_SECRET;
  const adminUser = process.env.ADMIN_BASIC_AUTH_USER;
  const adminPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  const authorization = request.headers.get("authorization") ?? "";

  if (bearerSecret && authorization.startsWith("Bearer ")) {
    const token = authorization.slice(7);
    const expected = Buffer.from(bearerSecret);
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  // Interactive browser requests use HTTP Basic Auth; credentials stay in server env
  // and are never embedded in client JavaScript.
  if (adminUser && adminPassword && authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator < 0) return false;
      const username = Buffer.from(decoded.slice(0, separator));
      const password = Buffer.from(decoded.slice(separator + 1));
      const expectedUser = Buffer.from(adminUser);
      const expectedPassword = Buffer.from(adminPassword);
      return (
        username.length === expectedUser.length &&
        timingSafeEqual(username, expectedUser) &&
        password.length === expectedPassword.length &&
        timingSafeEqual(password, expectedPassword)
      );
    } catch {
      return false;
    }
  }

  return false;
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
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="News Watch Fetch"' },
      },
    );
  }
  const rawBody = await request.json().catch(() => ({}));
  const parsed = FetchNewsBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid source", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const selectedSource = parsed.data.source;
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    return NextResponse.json(await executeFetch(selectedSource));
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let latest: FetchProgress = { stage: "fetching", completed: 0, total: 0, failed: 0 };
  const send = (event: Record<string, unknown>) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      closed = true;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const publishProgress = () =>
        send({
          type: "progress",
          stage: latest.stage,
          scoring: { completed: latest.completed, total: latest.total, failed: latest.failed },
        });
      publishProgress();
      heartbeatTimer = setInterval(publishProgress, 5_000);
      void executeFetch(
        selectedSource,
        (progress) => {
          const stageChanged = progress.stage !== latest.stage;
          latest = progress;
          if (stageChanged) publishProgress();
        },
        false,
      )
        .then((result) => {
          const cacheInvalidationToken = issueArticlesInvalidationToken();
          if (!cacheInvalidationToken) {
            send({ type: "error", error: "記事一覧を更新できませんでした" });
            return;
          }
          send({ type: "result", ...result, cacheInvalidationToken });
        })
        .catch((error: unknown) => {
          console.error("[fetch-news] Streaming fetch failed:", error);
          send({ type: "error", error: "ニュース取得に失敗しました" });
        })
        .finally(() => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET() {
  return NextResponse.json({
    message: "POST to fetch & score news. Configure KEYWORDS, API keys, and Turso DB.",
  });
}
