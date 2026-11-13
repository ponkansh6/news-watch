import { FatalError, sleep } from "workflow";
import {
  cleanupArticlesStep,
  capturePresendBoundaryStep,
  collectSourceCandidatesStep,
  finishJobStep,
  freezeCandidateBatchStep,
  getCandidateBatchStep,
  getFinalSourceSnapshotStep,
  getSourceSnapshotStep,
  invalidateSourceCacheStep,
  listCandidateBatchesStep,
  markCandidateBatchFailedStep,
  recoverSourceStep,
  recoverUnknownCandidateBatchStep,
  reconcileJobStep,
  refreshSourceRecencyStep,
  registerRunStep,
  retryFailedCandidateBatchStep,
  scoreCandidateBatchStep,
  summarizePendingCandidateSignaturesStep,
  type PresendMetricBoundary,
} from "./aggregate-refresh-steps";

const MAX_RATE_LIMIT_WAIT_CYCLES = 3;
const MAX_BATCH_WORKFLOW_CYCLES = 8;
const MAX_PARALLEL_SOURCE_COLLECTIONS = 2;

function requireCheckpoint(checkpointed: boolean, name: string): void {
  if (!checkpointed) throw new FatalError(`Refresh checkpoint rejected: ${name}`);
}

function safeWorkflowErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const errorCode =
    "code" in error && typeof error.code === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.code)
      ? error.code
      : null;
  return errorCode ?? (error.name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "unknown");
}

function emitCollectionWorkflowMetric(event: Record<string, string | number>): void {
  try {
    console.info("[aggregate-collection-workflow-metric]", JSON.stringify(event));
  } catch {
    // Metrics must not affect durable collection or recovery behavior.
  }
}

/** Executes the durable, registry-snapshotted all-source refresh. */
export async function aggregateRefreshWorkflow(
  jobId: string,
  executionToken: string,
): Promise<{ status: "completed" | "partial" | "failed"; failedSources: number }> {
  "use workflow";
  let collectionStartedAtMs: number | undefined;
  let collectionMetricEmitted = false;
  let collectionSourceCount = 0;
  let recoveryWaitRequestedMs = 0;
  try {
    await registerRunStep(jobId, executionToken);
    const snapshot = await getSourceSnapshotStep(jobId);
    if (snapshot.jobStatus !== "running") {
      throw new FatalError("Refresh job is not owned by this workflow");
    }
    const sources = snapshot.sources;
    collectionSourceCount = sources.length;
    if (sources.length === 0) throw new FatalError("Refresh job has no source snapshot");

    const startedAtMs = await capturePresendBoundaryStep(jobId, "collection-start", 0);
    collectionStartedAtMs = startedAtMs;
    let nextSourceIndex = 0;
    const recencyRefreshes: Promise<unknown>[] = [];
    const collectNextSource = async (): Promise<void> => {
      while (nextSourceIndex < sources.length) {
        const source = sources[nextSourceIndex++]!;
        if (source.status === "invalidated" || source.status === "failed") continue;
        let sourceForAttempt = source;
        for (let sourceCycle = 0; sourceCycle < 3; sourceCycle++) {
          if (sourceForAttempt.status === "unknown" || sourceForAttempt.status === "executing") {
            const recovery = await recoverSourceStep(
              jobId,
              executionToken,
              source.sourceId,
              sourceForAttempt.attemptCount,
            );
            if (recovery.kind === "failed") {
              sourceForAttempt = {
                ...sourceForAttempt,
                status: "failed",
                attemptCount: recovery.attemptCount,
              };
              break;
            }
            if (recovery.kind !== "retry") {
              await reconcileJobStep(jobId, executionToken, "source-recovery-not-claimable");
              throw new FatalError(`Refresh source recovery is not claimable: ${source.sourceId}`);
            }
            await sleep(1_000);
            recoveryWaitRequestedMs += 1_000;
            sourceForAttempt = {
              ...sourceForAttempt,
              status: "pending",
              attemptCount: recovery.attemptCount,
            };
          }

          let claimWaitCycles = 0;
          let result =
            sourceForAttempt.status === "saved"
              ? {
                  status: "saved" as const,
                  resultCount: sourceForAttempt.resultCount ?? 0,
                  attemptCount: sourceForAttempt.attemptCount,
                }
              : await collectSourceCandidatesStep(
                  jobId,
                  executionToken,
                  source.sourceId,
                  claimWaitCycles,
                );
          while (result.status === "deferred") {
            // A lower-ordinal source may still be committing its claim, or both
            // slots may be occupied. Wait durably, then reread the source state.
            if (claimWaitCycles >= 120) {
              throw new FatalError(`Refresh source claim remained pending: ${source.sourceId}`);
            }
            await sleep(25);
            claimWaitCycles++;
            result = await collectSourceCandidatesStep(
              jobId,
              executionToken,
              source.sourceId,
              claimWaitCycles,
            );
          }
          if (result.status === "unknown") {
            sourceForAttempt = {
              ...sourceForAttempt,
              status: "unknown",
              attemptCount: result.attemptCount,
            };
            continue;
          }
          sourceForAttempt = {
            ...sourceForAttempt,
            status: result.status,
            attemptCount: result.attemptCount,
            resultCount: result.resultCount,
            errorCode: result.errorCode ?? null,
          };
          if (result.status === "saved") {
            // Recency work starts as soon as candidates are durable, while this
            // worker immediately takes the next source slot.
            recencyRefreshes.push(
              refreshSourceRecencyStep(jobId, executionToken, source.sourceId, result.attemptCount),
            );
          }
          break;
        }
        if (sourceForAttempt.status === "unknown" || sourceForAttempt.status === "executing") {
          await reconcileJobStep(jobId, executionToken, "source-recovery-cycle-limit");
          throw new FatalError(
            `Refresh source recovery exceeded its bounded cycle: ${source.sourceId}`,
          );
        }
      }
    };
    const collectionWorkers = Array.from(
      { length: Math.min(MAX_PARALLEL_SOURCE_COLLECTIONS, sources.length) },
      () => collectNextSource(),
    );
    const workerResults = await Promise.allSettled(collectionWorkers);
    const workerFailure = workerResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    // Strict recency refreshes are part of the collection boundary. They may
    // overlap later source fetches, but all must settle before scoring starts.
    const recencyResults = await Promise.allSettled(recencyRefreshes);
    if (workerFailure) throw workerFailure.reason;
    const recencyFailure = recencyResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (recencyFailure) throw recencyFailure.reason;

    const collectionCompleteAtMs = await capturePresendBoundaryStep(jobId, "collection", 0);
    emitCollectionWorkflowMetric({
      jobId,
      sourceCount: sources.length,
      collectionElapsedMs: Math.max(0, collectionCompleteAtMs - startedAtMs),
      recoveryWaitRequestedMs,
      outcome: "completed",
    });
    collectionMetricEmitted = true;
    let failedBatches = 0;
    const runBatchUntilTerminal = async (
      batchId: string,
      initialBoundary: PresendMetricBoundary,
      initialStartedAtMs: number,
    ): Promise<void> => {
      let rateLimitWaitCycles = 0;
      let boundary = initialBoundary;
      for (let batchCycle = 0; batchCycle < MAX_BATCH_WORKFLOW_CYCLES; batchCycle++) {
        const presendStartedAtMs =
          batchCycle === 0
            ? initialStartedAtMs
            : await capturePresendBoundaryStep(jobId, batchId, batchCycle);
        const result = await scoreCandidateBatchStep(
          jobId,
          executionToken,
          batchId,
          presendStartedAtMs,
          boundary,
          batchCycle,
        );
        if (result.kind === "saved") return;
        if (result.kind === "wait") {
          rateLimitWaitCycles += 1;
          if (rateLimitWaitCycles >= MAX_RATE_LIMIT_WAIT_CYCLES) {
            requireCheckpoint(
              await markCandidateBatchFailedStep(
                jobId,
                executionToken,
                batchId,
                "gemini-rate-limit-wait-exhausted",
              ),
              "candidate-batch-rate-wait-exhausted",
            );
            failedBatches++;
            return;
          }
          await sleep(result.retryAfterMs);
          boundary = "rate_wait_complete";
          continue;
        }
        if (result.kind === "unknown") {
          const recovery = await recoverUnknownCandidateBatchStep(jobId, executionToken, batchId);
          if (recovery === "retry") {
            await sleep(1_000);
            boundary = "recovery_complete";
            continue;
          }
          if (recovery === "failed") {
            failedBatches++;
            return;
          }
          const latest = await getCandidateBatchStep(jobId, executionToken, batchId);
          if (latest?.status === "saved") return;
          if (latest?.status === "result_ready") continue;
          if (latest?.status === "failed") {
            failedBatches++;
            return;
          }
          await reconcileJobStep(jobId, executionToken, "candidate-batch-outcome-unresolved");
          throw new FatalError("Candidate batch could not be recovered safely");
        }
        if (await retryFailedCandidateBatchStep(jobId, executionToken, batchId)) continue;
        failedBatches++;
        return;
      }
      const latest = await getCandidateBatchStep(jobId, executionToken, batchId);
      if (latest?.status === "result_ready") {
        const presendStartedAtMs = await capturePresendBoundaryStep(
          jobId,
          batchId,
          MAX_BATCH_WORKFLOW_CYCLES,
        );
        const saved = await scoreCandidateBatchStep(
          jobId,
          executionToken,
          batchId,
          presendStartedAtMs,
          "recovery_complete",
          MAX_BATCH_WORKFLOW_CYCLES,
        );
        if (saved.kind === "saved") return;
      } else if (latest?.status === "unknown") {
        const recovered = await recoverUnknownCandidateBatchStep(jobId, executionToken, batchId);
        if (recovered === "failed") {
          failedBatches++;
          return;
        }
      } else if (latest && ["pending", "running"].includes(latest.status)) {
        requireCheckpoint(
          await markCandidateBatchFailedStep(
            jobId,
            executionToken,
            batchId,
            "candidate-batch-workflow-cycle-limit",
            latest.attemptCount,
          ),
          "candidate-batch-workflow-cycle-limit",
        );
        failedBatches++;
        return;
      }
      await reconcileJobStep(jobId, executionToken, "candidate-batch-workflow-cycle-limit");
      throw new FatalError("Candidate batch exceeded its bounded workflow cycle");
    };

    // Resolve batches already frozen by an earlier Workflow invocation first.
    let nextBatchBoundary: PresendMetricBoundary = "collection_complete";
    let nextBatchStartedAtMs = collectionCompleteAtMs;
    for (const batch of await listCandidateBatchesStep(jobId, executionToken)) {
      if (batch.status === "saved") continue;
      await runBatchUntilTerminal(batch.id, nextBatchBoundary, nextBatchStartedAtMs);
      nextBatchBoundary = "previous_batch_terminal";
      nextBatchStartedAtMs = await capturePresendBoundaryStep(jobId, batch.id, 100);
    }

    // Freeze after collection so duplicate URLs have a deterministic representative.
    const pendingBySignature = await summarizePendingCandidateSignaturesStep(jobId, executionToken);
    const maxFullBatches = pendingBySignature.reduce(
      (sum, signature) => sum + Math.floor(signature.candidateCount / 50),
      0,
    );
    for (let batchIndex = 0; batchIndex < maxFullBatches; batchIndex++) {
      const batchId = await freezeCandidateBatchStep(jobId, executionToken, false);
      if (!batchId) break;
      await runBatchUntilTerminal(batchId, nextBatchBoundary, nextBatchStartedAtMs);
      nextBatchBoundary = "previous_batch_terminal";
      nextBatchStartedAtMs = await capturePresendBoundaryStep(jobId, batchId, 100);
    }
    // All source collection is complete; now persist the final 1–49 item batch.
    for (let batchIndex = 0; batchIndex < pendingBySignature.length; batchIndex++) {
      const batchId = await freezeCandidateBatchStep(jobId, executionToken, true);
      if (!batchId) break;
      await runBatchUntilTerminal(batchId, nextBatchBoundary, nextBatchStartedAtMs);
      nextBatchBoundary = "previous_batch_terminal";
      nextBatchStartedAtMs = await capturePresendBoundaryStep(jobId, batchId, 100);
    }
    const remainingCandidates = await summarizePendingCandidateSignaturesStep(
      jobId,
      executionToken,
    );
    if (remainingCandidates.some((signature) => signature.candidateCount > 0)) {
      await reconcileJobStep(jobId, executionToken, "candidate-batches-remain-pending");
      throw new FatalError("Candidate batches remain pending after bounded flush");
    }

    // GC and cache invalidation happen after scoring has persisted its results.
    await cleanupArticlesStep();
    const collectedSources = await getFinalSourceSnapshotStep(jobId);
    for (const source of collectedSources.sources) {
      if (source.status === "saved") {
        await invalidateSourceCacheStep(
          jobId,
          executionToken,
          source.sourceId,
          source.attemptCount,
        );
      }
    }

    const finishedSnapshot = await getFinalSourceSnapshotStep(jobId);
    const failedSourceCount = finishedSnapshot.sources.filter(
      (source) => source.status === "failed" || source.errorCode !== null,
    ).length;
    const failedSources = failedSourceCount + failedBatches;
    const status =
      failedSources === 0
        ? "completed"
        : failedBatches === 0 && failedSourceCount === finishedSnapshot.sources.length
          ? "failed"
          : "partial";
    await finishJobStep(jobId, executionToken, status);
    return { status, failedSources };
  } catch (error) {
    if (collectionStartedAtMs !== undefined && !collectionMetricEmitted) {
      try {
        const collectionFailedAtMs = await capturePresendBoundaryStep(
          jobId,
          "collection-failed",
          0,
        );
        emitCollectionWorkflowMetric({
          jobId,
          sourceCount: collectionSourceCount,
          collectionElapsedMs: Math.max(0, collectionFailedAtMs - collectionStartedAtMs),
          recoveryWaitRequestedMs,
          outcome: "failed",
        });
      } catch {
        // Metrics must not alter durable collection or recovery behavior.
      }
    }
    await reconcileJobStep(jobId, executionToken, "workflow-requires-reconciliation");
    if (error instanceof FatalError) throw error;
    throw new FatalError(
      `Refresh workflow requires reconciliation (${safeWorkflowErrorCode(error)})`,
    );
  }
}
