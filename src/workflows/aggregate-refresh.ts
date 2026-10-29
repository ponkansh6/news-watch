import { revalidateTag } from "next/cache";
import { FatalError, getWorkflowMetadata, sleep } from "workflow";
import { SourceFetchError } from "@/lib/news/base/rss-fetcher";
import { fetchSource, type SourceFetchResponse } from "@/lib/news/fetch-service";
import type { SourceId } from "@/lib/news/registry";
import {
  bindWorkflowRun,
  canStartRefreshSource,
  claimRefreshSource,
  finishRefreshJob,
  getOwnedRefreshJob,
  getRefreshJobSources,
  isRefreshCacheInvalidationPending,
  markNeedsReconciliation,
  markRefreshSourceFailed,
  markRefreshSourceInvalidated,
  markRefreshSourceSaved,
  markRefreshSourceUnknown,
  recordAdapterStart,
  setNextEligibleAt,
  type RefreshSourceStatus,
} from "@/lib/db/repository/refresh-job-repository";

type SourceSnapshot = {
  sourceId: SourceId;
  status: RefreshSourceStatus;
  adapterStartedAt: string | null;
  resultCount: number | null;
  errorCode: string | null;
};

type RefreshSnapshot = {
  jobStatus: string;
  sources: SourceSnapshot[];
};

type SourceRunResult = {
  status: "saved" | "failed";
  resultCount: number;
  errorCode?: string;
};

function requireCheckpoint(checkpointed: boolean, name: string): void {
  if (!checkpointed) throw new FatalError(`Refresh checkpoint rejected: ${name}`);
}

async function registerRunStep(jobId: string, executionToken: string) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const bound = await bindWorkflowRun(jobId, executionToken, workflowRunId);
  requireCheckpoint(bound, "run-owner");
  return workflowRunId;
}
Object.assign(registerRunStep, { maxRetries: 0 });

async function getSourceSnapshotStep(jobId: string): Promise<RefreshSnapshot> {
  "use step";
  const job = await getOwnedRefreshJob(jobId);
  if (!job) throw new FatalError("Refresh job does not exist");
  return {
    jobStatus: job.status,
    sources: (await getRefreshJobSources(jobId)).map((source) => ({
      sourceId: source.sourceId as SourceId,
      status: source.status,
      adapterStartedAt: source.adapterStartedAt,
      resultCount: source.resultCount,
      errorCode: source.errorCode,
    })),
  };
}

async function getFinalSourceSnapshotStep(jobId: string): Promise<RefreshSnapshot> {
  "use step";
  const job = await getOwnedRefreshJob(jobId);
  if (!job) throw new FatalError("Refresh job does not exist");
  return {
    jobStatus: job.status,
    sources: (await getRefreshJobSources(jobId)).map((source) => ({
      sourceId: source.sourceId as SourceId,
      status: source.status,
      adapterStartedAt: source.adapterStartedAt,
      resultCount: source.resultCount,
      errorCode: source.errorCode,
    })),
  };
}

async function refreshSourceStep(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
): Promise<SourceRunResult> {
  "use step";
  const claim = await claimRefreshSource(jobId, executionToken, sourceId);
  if (!claim) {
    const [source] = (await getRefreshJobSources(jobId)).filter(
      (item) => item.sourceId === sourceId,
    );
    if (source?.status === "invalidated")
      return { status: "saved", resultCount: source.resultCount ?? 0 };
    if (source?.status === "failed")
      return { status: "failed", resultCount: source.resultCount ?? 0 };
    if (source?.status === "saved") {
      return {
        status: "saved",
        resultCount: source.resultCount ?? 0,
        errorCode: source.errorCode ?? undefined,
      };
    }
    throw new FatalError(`Refresh source is not safely claimable: ${sourceId}`);
  }

  let response: SourceFetchResponse;
  try {
    response = await fetchSource(sourceId, undefined, {
      strictAdapterErrors: true,
      beforeAdapterStart: () => canStartRefreshSource(jobId, executionToken, sourceId),
      onAdapterStart: (startedAt) => recordAdapterStart(jobId, executionToken, sourceId, startedAt),
    });
  } catch (error) {
    if (error instanceof SourceFetchError) {
      const marked = await markRefreshSourceFailed(
        jobId,
        executionToken,
        sourceId,
        `source-${error.kind}`,
      );
      requireCheckpoint(marked, "source-failed");
      return { status: "failed", resultCount: 0 };
    }

    await markRefreshSourceUnknown(jobId, executionToken, sourceId, "source-outcome-unknown");
    await markNeedsReconciliation(jobId, executionToken, "source-outcome-unknown");
    throw new FatalError(`Refresh source outcome needs reconciliation: ${sourceId}`);
  }

  const resultCount = response.results.reduce((total, result) => total + (result.saved ?? 0), 0);
  const hasProcessingErrors = response.results.some(
    (result) => (result.errors?.length ?? 0) > 0 || (result.scoringErrors?.length ?? 0) > 0,
  );
  // Keep a categorical partial-failure marker; raw messages may contain
  // provider details and are not needed in durable Workflow state.
  const errorCode = hasProcessingErrors ? "source-processing-partial" : undefined;
  const marked = await markRefreshSourceSaved(
    jobId,
    executionToken,
    sourceId,
    resultCount,
    new Date().toISOString(),
    errorCode,
  );
  if (!marked) {
    await markRefreshSourceUnknown(jobId, executionToken, sourceId, "saved-checkpoint-unknown");
    await markNeedsReconciliation(jobId, executionToken, "saved-checkpoint-unknown");
    throw new FatalError(`Refresh save checkpoint needs reconciliation: ${sourceId}`);
  }
  return { status: "saved", resultCount, errorCode };
}
Object.assign(refreshSourceStep, { maxRetries: 0 });

async function invalidateSourceCacheStep(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
) {
  "use step";
  const pending = await isRefreshCacheInvalidationPending(jobId, executionToken, sourceId);
  if (!pending) {
    const [source] = (await getRefreshJobSources(jobId)).filter(
      (item) => item.sourceId === sourceId,
    );
    if (source?.status === "invalidated") return false;
    throw new FatalError(`Refresh cache invalidation is not safely claimable: ${sourceId}`);
  }

  revalidateTag("articles", { expire: 0 });
  const marked = await markRefreshSourceInvalidated(jobId, executionToken, sourceId);
  if (!marked) {
    const [source] = (await getRefreshJobSources(jobId)).filter(
      (item) => item.sourceId === sourceId,
    );
    if (source?.status === "invalidated") return false;
    throw new FatalError(`Refresh cache invalidation checkpoint failed: ${sourceId}`);
  }
  return true;
}

async function setNextSourceGateStep(
  jobId: string,
  executionToken: string,
): Promise<string | null> {
  "use step";
  const sources = await getRefreshJobSources(jobId);
  const latestStart = sources.reduce<string | null>(
    (latest, source) =>
      source.adapterStartedAt && (!latest || source.adapterStartedAt > latest)
        ? source.adapterStartedAt
        : latest,
    null,
  );
  const hasPendingSource = sources.some((source) => source.status === "pending");
  if (!latestStart || !hasPendingSource) return null;

  // Anchor the gate to the true previous adapter-call boundary. Any elapsed
  // processing time counts toward the 70 seconds; the DB preflight enforces it.
  const nextEligibleAt = new Date(Date.parse(latestStart) + 70_000).toISOString();
  const updated = await setNextEligibleAt(jobId, executionToken, nextEligibleAt);
  requireCheckpoint(updated, "next-source-gate");
  return nextEligibleAt;
}

async function finishJobStep(
  jobId: string,
  executionToken: string,
  status: "completed" | "partial" | "failed",
) {
  "use step";
  const finished = await finishRefreshJob(jobId, executionToken, status);
  requireCheckpoint(finished, "job-finished");
}

async function reconcileJobStep(jobId: string, executionToken: string, errorCode: string) {
  "use step";
  await markNeedsReconciliation(jobId, executionToken, errorCode);
}
Object.assign(reconcileJobStep, { maxRetries: 0 });

/** Executes the durable, registry-snapshotted all-source refresh. */
export async function aggregateRefreshWorkflow(
  jobId: string,
  executionToken: string,
): Promise<{ status: "completed" | "partial" | "failed"; failedSources: number }> {
  "use workflow";
  try {
    await registerRunStep(jobId, executionToken);
    const snapshot = await getSourceSnapshotStep(jobId);
    if (snapshot.jobStatus !== "running") {
      throw new FatalError("Refresh job is not owned by this workflow");
    }
    const sources = snapshot.sources;
    if (sources.length === 0) throw new FatalError("Refresh job has no source snapshot");

    for (const source of sources) {
      if (source.status === "invalidated" || source.status === "failed") continue;
      if (source.status === "unknown" || source.status === "executing") {
        await reconcileJobStep(jobId, executionToken, "source-checkpoint-unknown");
        throw new FatalError(`Refresh source requires reconciliation: ${source.sourceId}`);
      }

      let result: SourceRunResult;
      if (source.status === "saved") {
        result = { status: "saved", resultCount: source.resultCount ?? 0 };
      } else {
        result = await refreshSourceStep(jobId, executionToken, source.sourceId);
      }

      if (result.status === "saved") {
        await invalidateSourceCacheStep(jobId, executionToken, source.sourceId);
      }

      const nextEligibleAt = await setNextSourceGateStep(jobId, executionToken);
      if (nextEligibleAt) {
        const remainingDelayMs = Date.parse(nextEligibleAt) - Date.now();
        if (remainingDelayMs > 0) await sleep(remainingDelayMs);
      }
    }

    const finishedSnapshot = await getFinalSourceSnapshotStep(jobId);
    const failedSources = finishedSnapshot.sources.filter(
      (source) => source.status === "failed" || source.errorCode !== null,
    ).length;
    const status =
      failedSources === 0
        ? "completed"
        : failedSources === finishedSnapshot.sources.length
          ? "failed"
          : "partial";
    await finishJobStep(jobId, executionToken, status);
    return { status, failedSources };
  } catch (error) {
    await reconcileJobStep(jobId, executionToken, "workflow-requires-reconciliation");
    if (error instanceof FatalError) throw error;
    throw new FatalError("Refresh workflow requires reconciliation");
  }
}
