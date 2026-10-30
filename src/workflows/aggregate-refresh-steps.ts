import { revalidateTag } from "next/cache";
import { FatalError, getWorkflowMetadata } from "workflow";
import { SourceFetchError } from "@/lib/news/base/rss-fetcher";
import {
  collectRefreshCandidates,
  persistIdentifiedCandidateBatch,
  refreshStagedSourceRecency,
  type CollectRefreshCandidatesResult,
} from "@/lib/news/fetch-service";
import type { SourceId } from "@/lib/news/registry";
import { scoreArticlesById, type IdentifiedArticleScore, type LLMResponse } from "@/lib/llm";
import { GeminiSlotWaitError, geminiLeaseEvidence } from "@/lib/llm/client";
import { gcStaleArticles } from "@/app/api/fetch-news/pipeline/maintenance";
import {
  claimCandidateBatch,
  deferCandidateBatchForRateLimit,
  freezeNextCandidateBatch,
  getBatchCandidates,
  getCandidateBatch,
  listCandidateBatches,
  listRefreshJobCandidates,
  markCandidateBatchFailed,
  markCandidateBatchSaved,
  markCandidateBatchUnknown,
  recoverUnknownCandidateBatch,
  retryFailedCandidateBatch,
  summarizePendingCandidateSignatures,
  storeCandidateBatchResult,
} from "@/lib/db/repository/refresh-candidate-repository";
import {
  bindWorkflowRun,
  canStartRefreshSource,
  claimRefreshSource,
  finishRefreshJob,
  getOwnedRefreshJob,
  getRefreshJobSources,
  isRefreshCacheInvalidationPending,
  markNeedsReconciliation,
  recoverRefreshSource,
  markRefreshSourceFailed,
  markRefreshSourceInvalidated,
  markRefreshSourceUnknown,
  recordAdapterStart,
  type RefreshSourceStatus,
} from "@/lib/db/repository/refresh-job-repository";

type SourceSnapshot = {
  sourceId: SourceId;
  status: RefreshSourceStatus;
  adapterStartedAt: string | null;
  resultCount: number | null;
  errorCode: string | null;
  attemptCount: number;
};

type RefreshSnapshot = {
  jobStatus: string;
  sources: SourceSnapshot[];
};

type SourceRunResult = {
  status: "saved" | "failed" | "unknown";
  resultCount: number;
  attemptCount: number;
  errorCode?: string;
};

type CandidateBatchRunResult =
  | { kind: "saved" }
  | { kind: "wait"; retryAfterMs: number }
  | { kind: "failed"; errorCode: string }
  | { kind: "unknown" };

export type PresendMetricBoundary =
  | "collection_complete"
  | "previous_batch_terminal"
  | "rate_wait_complete"
  | "recovery_complete";

function emitPresendMetric(event: Record<string, string | number | boolean | null>): void {
  try {
    console.info("[aggregate-presend-metric]", JSON.stringify(event));
  } catch {
    // Observability must never affect scoring or durable checkpoints.
  }
}

function requireCheckpoint(checkpointed: boolean, name: string): void {
  if (!checkpointed) throw new FatalError(`Refresh checkpoint rejected: ${name}`);
}

export async function registerRunStep(jobId: string, executionToken: string) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const bound = await bindWorkflowRun(jobId, executionToken, workflowRunId);
  requireCheckpoint(bound, "run-owner");
  return workflowRunId;
}
Object.assign(registerRunStep, { maxRetries: 0 });

export async function getSourceSnapshotStep(jobId: string): Promise<RefreshSnapshot> {
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
      attemptCount: source.attemptCount,
    })),
  };
}

export async function getFinalSourceSnapshotStep(jobId: string): Promise<RefreshSnapshot> {
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
      attemptCount: source.attemptCount,
    })),
  };
}

export async function collectSourceCandidatesStep(
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
      return {
        status: "saved",
        resultCount: source.resultCount ?? 0,
        attemptCount: source.attemptCount,
      };
    if (source?.status === "failed")
      return {
        status: "failed",
        resultCount: source.resultCount ?? 0,
        attemptCount: source.attemptCount,
      };
    if (source?.status === "saved") {
      return {
        status: "saved",
        resultCount: source.resultCount ?? 0,
        attemptCount: source.attemptCount,
        errorCode: source.errorCode ?? undefined,
      };
    }
    throw new FatalError(`Refresh source is not safely claimable: ${sourceId}`);
  }

  const sourceAttemptCount = claim.attemptCount;
  let response: CollectRefreshCandidatesResult;
  try {
    response = await collectRefreshCandidates(sourceId, jobId, executionToken, {
      strictAdapterErrors: true,
      sourceAttemptCount,
      beforeAdapterStart: () =>
        canStartRefreshSource(jobId, executionToken, sourceId, sourceAttemptCount),
      onAdapterStart: (startedAt) =>
        recordAdapterStart(jobId, executionToken, sourceId, sourceAttemptCount, startedAt),
    });
  } catch (error) {
    // Candidate staging and the source checkpoint commit atomically. If the
    // response was lost after commit, reread before deciding whether to retry
    // or mark this source unknown; never run the adapter twice for a saved row.
    let currentSource: Awaited<ReturnType<typeof getRefreshJobSources>>[number] | undefined;
    try {
      currentSource = (await getRefreshJobSources(jobId)).find(
        (item) => item.sourceId === sourceId,
      );
    } catch {
      await markRefreshSourceUnknown(
        jobId,
        executionToken,
        sourceId,
        "source-outcome-unknown",
        sourceAttemptCount,
      );
      return { status: "unknown", resultCount: 0, attemptCount: sourceAttemptCount };
    }
    if (currentSource?.status === "saved") {
      return {
        status: "saved",
        resultCount: currentSource.resultCount ?? 0,
        attemptCount: currentSource.attemptCount,
      };
    }
    if (error instanceof SourceFetchError) {
      const marked = await markRefreshSourceFailed(
        jobId,
        executionToken,
        sourceId,
        `source-${error.kind}`,
        sourceAttemptCount,
      );
      requireCheckpoint(marked, "source-failed");
      return { status: "failed", resultCount: 0, attemptCount: sourceAttemptCount };
    }

    await markRefreshSourceUnknown(
      jobId,
      executionToken,
      sourceId,
      "source-outcome-unknown",
      sourceAttemptCount,
    );
    return { status: "unknown", resultCount: 0, attemptCount: sourceAttemptCount };
  }

  const resultCount = response.selected;
  const errorCode = undefined;
  return { status: "saved", resultCount, attemptCount: sourceAttemptCount, errorCode };
}
Object.assign(collectSourceCandidatesStep, { maxRetries: 0 });

export async function recoverSourceStep(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  expectedAttemptCount: number,
) {
  "use step";
  return recoverRefreshSource(jobId, executionToken, sourceId, expectedAttemptCount, 2);
}

export async function refreshSourceRecencyStep(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
): Promise<void> {
  "use step";
  await refreshStagedSourceRecency(jobId, executionToken, sourceId, sourceAttemptCount);
}

export async function freezeCandidateBatchStep(
  jobId: string,
  executionToken: string,
  flushTail: boolean,
): Promise<string | null> {
  "use step";
  const existingBatch = (await listCandidateBatches(jobId, executionToken)).find((batch) =>
    ["pending", "result_ready", "running"].includes(batch.status),
  );
  if (existingBatch) return existingBatch.id;
  const pending = await summarizePendingCandidateSignatures(jobId, executionToken);
  for (const summary of pending) {
    if (summary.candidateCount >= 50 || flushTail) {
      const batch = await freezeNextCandidateBatch(
        jobId,
        executionToken,
        summary.scoringSignature,
        flushTail,
      );
      if (batch) return batch.id;
    }
  }
  return null;
}

export async function listCandidateBatchesStep(jobId: string, executionToken: string) {
  "use step";
  const batches = await listCandidateBatches(jobId, executionToken);
  return batches.map((batch) => ({ id: batch.id, status: batch.status }));
}

/** Capture a durable timestamp before a batch scoring attempt. */
export async function capturePresendBoundaryStep(
  jobId: string,
  batchId: string,
  workflowCycle: number,
): Promise<number> {
  "use step";
  void jobId;
  void batchId;
  void workflowCycle;
  return Date.now();
}

export async function listRefreshJobCandidatesStep(
  jobId: string,
  executionToken: string,
  statuses: ("pending" | "batched" | "saved" | "failed")[],
) {
  "use step";
  return listRefreshJobCandidates(jobId, executionToken, statuses);
}

export async function summarizePendingCandidateSignaturesStep(
  jobId: string,
  executionToken: string,
) {
  "use step";
  return summarizePendingCandidateSignatures(jobId, executionToken);
}

export async function retryFailedCandidateBatchStep(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<boolean> {
  "use step";
  const retried = await retryFailedCandidateBatch(jobId, executionToken, batchId, 2);
  if (retried) return true;
  // Make a lost response after the transaction idempotent on Workflow replay.
  const current = await getCandidateBatch(jobId, executionToken, batchId);
  return current?.status === "pending";
}

export async function markCandidateBatchFailedStep(
  jobId: string,
  executionToken: string,
  batchId: string,
  errorCode: string,
  attemptCount?: number,
): Promise<boolean> {
  "use step";
  if (attemptCount === undefined) {
    return markCandidateBatchFailed(jobId, executionToken, batchId, errorCode);
  }
  return markCandidateBatchFailed(jobId, executionToken, batchId, errorCode, attemptCount);
}

export async function recoverUnknownCandidateBatchStep(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<"retry" | "failed" | "not-claimable"> {
  "use step";
  return recoverUnknownCandidateBatch(jobId, executionToken, batchId, 2);
}

export async function getCandidateBatchStep(
  jobId: string,
  executionToken: string,
  batchId: string,
) {
  "use step";
  return getCandidateBatch(jobId, executionToken, batchId);
}

export async function scoreCandidateBatchStep(
  jobId: string,
  executionToken: string,
  batchId: string,
  presendStartedAtMs: number,
  presendBoundary: PresendMetricBoundary,
  workflowCycle: number,
): Promise<CandidateBatchRunResult> {
  "use step";
  const existing = await getCandidateBatch(jobId, executionToken, batchId);
  if (!existing) throw new FatalError("Candidate batch does not exist");
  if (existing.status === "saved") return { kind: "saved" };
  if (existing.status === "unknown") return { kind: "unknown" };
  if (existing.status === "failed")
    return { kind: "failed", errorCode: existing.errorCode ?? "candidate-batch-failed" };

  let batch = existing;
  if (batch.status === "pending") {
    const claimed = await claimCandidateBatch(jobId, executionToken, batchId);
    if (!claimed) {
      const latest = await getCandidateBatch(jobId, executionToken, batchId);
      if (latest?.status === "saved") return { kind: "saved" };
      if (latest?.status === "result_ready") batch = latest;
      else if (latest?.status === "running") {
        await markCandidateBatchUnknown(
          jobId,
          executionToken,
          batchId,
          "batch-replay-ambiguous",
          latest.attemptCount,
        );
        return { kind: "unknown" };
      } else throw new FatalError("Candidate batch is not claimable");
    } else batch = claimed;
  } else if (batch.status === "running") {
    // The prior durable step may have sent the request before losing its event result.
    await markCandidateBatchUnknown(
      jobId,
      executionToken,
      batchId,
      "batch-replay-ambiguous",
      batch.attemptCount,
    );
    return { kind: "unknown" };
  }

  if (batch.status === "running") {
    const candidates = await getBatchCandidates(jobId, executionToken, batchId);
    let scores: IdentifiedArticleScore[];
    let internalRetryIndex = 0;
    try {
      scores = await scoreArticlesById(
        candidates.map((candidate) => {
          const payload = JSON.parse(candidate.payloadJson) as Record<string, unknown>;
          return {
            id: candidate.id,
            title: String(payload.title ?? ""),
            description: typeof payload.description === "string" ? payload.description : null,
          };
        }),
        String(
          (JSON.parse(candidates[0]?.payloadJson ?? "{}") as Record<string, unknown>)
            .preferenceSection ?? "",
        ),
        {
          timeoutMs: 25_000,
          retries: 2,
          rateWaitMode: "throw",
          leaseEvidence: geminiLeaseEvidence("workflow-step-300-v1"),
          onHttpAttempt: () => {
            internalRetryIndex += 1;
            const observedAtMs = Date.now();
            emitPresendMetric({
              eventId: `${jobId}:${batchId}:${batch.attemptCount}:${workflowCycle}:${internalRetryIndex}:sdk-call`,
              jobId,
              batchId,
              batchAttempt: batch.attemptCount,
              workflowCycle,
              internalRetryIndex,
              boundary: presendBoundary,
              elapsedMsFromDurableBoundary:
                observedAtMs >= presendStartedAtMs ? observedAtMs - presendStartedAtMs : null,
              boundaryClockRelation:
                observedAtMs < presendStartedAtMs
                  ? "observed_before_boundary"
                  : "observed_after_or_equal_boundary",
              elapsedIncludes: "shared_slot_claim_and_attempt_checkpoint",
              measurement: "sdk_call_before_generateContent_not_http_start",
            });
          },
        },
      );
    } catch (error) {
      if (error instanceof GeminiSlotWaitError) {
        emitPresendMetric({
          eventId: `${jobId}:${batchId}:${batch.attemptCount}:${workflowCycle}:rate-wait`,
          jobId,
          batchId,
          batchAttempt: batch.attemptCount,
          workflowCycle,
          boundary: presendBoundary,
          requestedWaitMs: error.retryAfterMs ?? null,
          attemptsSent: error.attemptsSent,
          event: "shared_slot_wait",
        });
        if (!error.recoverable || error.retryAfterMs === undefined) {
          requireCheckpoint(
            await markCandidateBatchFailed(
              jobId,
              executionToken,
              batchId,
              "gemini-owner-unrecoverable",
              batch.attemptCount,
            ),
            "candidate-batch-gemini-owner-unrecoverable",
          );
          return { kind: "failed", errorCode: "gemini-owner-unrecoverable" };
        }
        if (error.attemptsSent > 0 && batch.attemptCount >= 2) {
          requireCheckpoint(
            await markCandidateBatchFailed(
              jobId,
              executionToken,
              batchId,
              "candidate-batch-attempt-limit",
              batch.attemptCount,
            ),
            "candidate-batch-attempt-limit",
          );
          return { kind: "failed", errorCode: "candidate-batch-attempt-limit" };
        }
        const deferred = await deferCandidateBatchForRateLimit(
          jobId,
          executionToken,
          batchId,
          error.attemptsSent > 0,
        );
        requireCheckpoint(deferred, "candidate-batch-rate-wait");
        return { kind: "wait", retryAfterMs: error.retryAfterMs };
      }
      requireCheckpoint(
        await markCandidateBatchFailed(
          jobId,
          executionToken,
          batchId,
          "candidate-batch-scoring-failed",
          batch.attemptCount,
        ),
        "candidate-batch-scoring-failed",
      );
      return { kind: "failed", errorCode: "candidate-batch-scoring-failed" };
    }

    const resultById = Object.fromEntries(scores.map(({ id, score }) => [id, score]));
    try {
      const stored = await storeCandidateBatchResult(
        jobId,
        executionToken,
        batchId,
        resultById,
        batch.attemptCount,
      );
      if (!stored) throw new Error("candidate_batch_result_checkpoint_rejected");
    } catch {
      // The result write may have committed despite a lost DB response. Resume
      // persistence from result_ready; never convert an ambiguous result to failed.
      const latest = await getCandidateBatch(jobId, executionToken, batchId);
      if (latest?.status === "result_ready") batch = latest;
      else {
        await markCandidateBatchUnknown(
          jobId,
          executionToken,
          batchId,
          "candidate-result-checkpoint-unknown",
          batch.attemptCount,
        );
        return { kind: "unknown" };
      }
    }
    if (batch.status !== "result_ready") {
      batch = (await getCandidateBatch(jobId, executionToken, batchId)) ?? batch;
    }
  }

  if (batch.status === "result_ready") {
    const stored = JSON.parse(batch.resultJson ?? "{}") as Record<string, unknown>;
    const scores = Object.entries(stored).map(([id, score]) => ({
      id,
      score: score as LLMResponse,
    }));
    await persistIdentifiedCandidateBatch(jobId, executionToken, batchId, scores);
    requireCheckpoint(
      await markCandidateBatchSaved(jobId, executionToken, batchId),
      "candidate-batch-saved",
    );
    return { kind: "saved" };
  }
  return { kind: "unknown" };
}
Object.assign(scoreCandidateBatchStep, { maxRetries: 0 });

export async function invalidateSourceCacheStep(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
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
  const marked = await markRefreshSourceInvalidated(
    jobId,
    executionToken,
    sourceId,
    sourceAttemptCount,
  );
  if (!marked) {
    const [source] = (await getRefreshJobSources(jobId)).filter(
      (item) => item.sourceId === sourceId,
    );
    if (source?.status === "invalidated") return false;
    throw new FatalError(`Refresh cache invalidation checkpoint failed: ${sourceId}`);
  }
  return true;
}

export async function finishJobStep(
  jobId: string,
  executionToken: string,
  status: "completed" | "partial" | "failed",
) {
  "use step";
  const finished = await finishRefreshJob(jobId, executionToken, status);
  requireCheckpoint(finished, "job-finished");
}

export async function reconcileJobStep(jobId: string, executionToken: string, errorCode: string) {
  "use step";
  await markNeedsReconciliation(jobId, executionToken, errorCode);
}
Object.assign(reconcileJobStep, { maxRetries: 0 });

export async function cleanupArticlesStep() {
  "use step";
  return gcStaleArticles();
}
