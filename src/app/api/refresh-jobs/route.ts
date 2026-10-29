import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { aggregateRefreshWorkflow } from "@/workflows/aggregate-refresh";
import { getRefreshArticleProgress } from "@/lib/db/repository/refresh-candidate-repository";
import {
  bindWorkflowRun,
  getActiveRefreshSlot,
  getOwnedRefreshJob,
  getRefreshJobSources,
  markEnqueueUnknown,
  markNeedsReconciliation,
  startAggregateJob,
} from "@/lib/db/repository/refresh-job-repository";
import { isNewsApiAuthorized } from "@/lib/news/api-auth";
import { tryRecoverActiveRefreshJob } from "@/lib/refresh-job-auto-recovery";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isNewsApiAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="News Watch Fetch"' },
      },
    );
  }

  await tryRecoverActiveRefreshJob();
  const slot = await getActiveRefreshSlot();
  const job =
    slot?.ownerKind === "job" && slot.ownerId ? await getOwnedRefreshJob(slot.ownerId) : null;
  if (!job) return NextResponse.json({ job: null });
  const [sources, articleProgress] = await Promise.all([
    getRefreshJobSources(job.id),
    getRefreshArticleProgress(job.id),
  ]);
  if (!articleProgress) return NextResponse.json({ job: null });
  return NextResponse.json({ job: publicJob(job, sources, articleProgress) });
}

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

  let result = await startAggregateJob();
  if (
    (result.kind === "busy" || result.job?.status === "needs_reconciliation") &&
    (await tryRecoverActiveRefreshJob())
  ) {
    // The recovery helper makes one attempt; retry the slot claim once only.
    result = await startAggregateJob();
  }
  if (!result.job) {
    return NextResponse.json({ error: "refresh already running", jobId: null }, { status: 409 });
  }
  const initialJob = result.job;
  const jobId = initialJob.id;

  if (result.kind === "busy") {
    return NextResponse.json(
      { error: "refresh already running", jobId: result.job.id, status: result.job.status },
      { status: 409 },
    );
  }

  if (result.kind === "created") {
    if (!result.executionToken) {
      return NextResponse.json(
        { jobId, status: initialJob.status, revision: initialJob.revision },
        { status: 202 },
      );
    }
    try {
      const run = await start(aggregateRefreshWorkflow, [jobId, result.executionToken]);
      // The workflow's first step also binds its run ID, covering a lost HTTP response.
      const bound = await bindWorkflowRun(jobId, result.executionToken, run.runId);
      if (!bound) {
        await markNeedsReconciliation(jobId, result.executionToken, "run-bind-rejected");
      }
    } catch {
      // The SDK cannot look a run up by job ID. Keep this job held for reconciliation.
      await markEnqueueUnknown(jobId, result.executionToken).catch(() => false);
      await markNeedsReconciliation(jobId, result.executionToken, "enqueue_unknown").catch(
        () => false,
      );
    }
  }

  const [job, sources] = await Promise.all([
    getOwnedRefreshJob(jobId).then((updated) => updated ?? initialJob),
    getRefreshJobSources(jobId),
  ]);
  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      revision: job.revision,
      sources: sources.map(publicSource),
    },
    { status: result.kind === "created" ? 202 : 200 },
  );
}

function publicJob(
  job: NonNullable<Awaited<ReturnType<typeof getOwnedRefreshJob>>>,
  sources: Awaited<ReturnType<typeof getRefreshJobSources>>,
  articleProgress: Awaited<ReturnType<typeof getRefreshArticleProgress>>,
) {
  return {
    jobId: job.id,
    status: job.status,
    currentSourceId: job.currentSourceId,
    revision: job.revision,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    nextEligibleAt: job.nextEligibleAt,
    errorCode: job.errorCode,
    articleProgress,
    sources: sources.map(publicSource),
  };
}

function publicSource(source: Awaited<ReturnType<typeof getRefreshJobSources>>[number]) {
  return {
    sourceId: source.sourceId,
    status: source.status,
    adapterStartedAt: source.adapterStartedAt,
    savedAt: source.savedAt,
    cacheInvalidatedAt: source.cacheInvalidatedAt,
    completedAt: source.completedAt,
    resultCount: source.resultCount,
    errorCode: source.errorCode,
  };
}
