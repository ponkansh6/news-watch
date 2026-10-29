import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  SOURCE_IDS,
  getSourceAdapter,
  normalizeUnknownSource,
  type SourceId,
} from "@/lib/news/registry";
import { FetchNewsBodySchema } from "./schema";
import { type NormalizedArticle } from "@/lib/types";
import { issueArticlesInvalidationToken } from "@/lib/cache-invalidation-token";
import { fetchSource, type FetchProgress } from "@/lib/news/fetch-service";
import { isNewsApiAuthorized } from "@/lib/news/api-auth";
import { geminiLeaseEvidence } from "@/lib/llm/client";
import {
  claimSingleRefresh,
  getActiveRefreshSlot,
  getOwnedRefreshJob,
  releaseSingleRefresh,
} from "@/lib/db/repository/refresh-job-repository";

export const maxDuration = 60;
export const SUPPORTED_SOURCE_IDS = SOURCE_IDS;

export function normalize(article: unknown, sourceId: string): NormalizedArticle {
  const adapter = getSourceAdapter(sourceId);
  return adapter ? adapter.toArticle(article, sourceId) : normalizeUnknownSource(article, sourceId);
}

async function executeFetch(
  selectedSource: SourceId,
  onProgress?: (progress: FetchProgress) => void,
  invalidateArticleCache = true,
  leaseEvidence?: ReturnType<typeof geminiLeaseEvidence>,
) {
  const response = await fetchSource(selectedSource, onProgress, {
    geminiLeaseEvidence: leaseEvidence,
  });
  if (invalidateArticleCache) revalidateTag("articles", { expire: 0 });
  return response;
}

/* ---------- POST handler ---------- */

export async function POST(request: Request) {
  if (!isNewsApiAuthorized(request)) {
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
  const leaseEvidence = geminiLeaseEvidence("request-60-v1");
  const slotLeaseEvidence =
    leaseEvidence?.kind === "request-60-v1" && leaseEvidence.deploymentId
      ? { kind: "request-60-v1" as const, deploymentId: leaseEvidence.deploymentId }
      : { kind: "unknown" as const };
  const claim = await claimSingleRefresh(slotLeaseEvidence);
  if (claim.kind !== "claimed" || !claim.ownerId || !claim.ownerToken) {
    const slot = await getActiveRefreshSlot();
    const job =
      slot?.ownerKind === "job" && slot.ownerId ? await getOwnedRefreshJob(slot.ownerId) : null;
    const body = {
      type: "busy",
      error: "refresh already running",
      jobId: job?.id ?? null,
      status: job?.status ?? null,
    };
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return new Response(`${JSON.stringify(body)}\n`, {
        status: 409,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }
    return NextResponse.json(body, { status: 409 });
  }
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    try {
      return NextResponse.json(
        await executeFetch(selectedSource, undefined, true, geminiLeaseEvidence("request-60-v1")),
      );
    } finally {
      await releaseSingleRefresh(claim.ownerId, claim.ownerToken);
    }
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
      heartbeatTimer = setInterval(publishProgress, 2_000);
      void executeFetch(
        selectedSource,
        (progress) => {
          const stageChanged = progress.stage !== latest.stage;
          latest = progress;
          if (stageChanged) publishProgress();
        },
        false,
        geminiLeaseEvidence("request-60-v1"),
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
          void releaseSingleRefresh(claim.ownerId!, claim.ownerToken!).catch((error: unknown) => {
            console.error("[fetch-news] Failed to release refresh slot:", error);
          });
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
