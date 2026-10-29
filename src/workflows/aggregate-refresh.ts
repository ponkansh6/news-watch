import { FatalError, sleep } from "workflow";
import {
  cleanupArticlesStep,
  collectSourceCandidatesStep,
  finishJobStep,
  freezeCandidateBatchStep,
  getCandidateBatchStep,
  getFinalSourceSnapshotStep,
  getSourceSnapshotStep,
  invalidateSourceCacheStep,
  listCandidateBatchesStep,
  listRefreshJobCandidatesStep,
  markCandidateBatchFailedStep,
  recoverSourceStep,
  recoverUnknownCandidateBatchStep,
  reconcileJobStep,
  refreshSourceRecencyStep,
  registerRunStep,
  retryFailedCandidateBatchStep,
  scoreCandidateBatchStep,
} from "./aggregate-refresh-steps";

const MAX_RATE_LIMIT_WAIT_CYCLES = 3;
const MAX_BATCH_WORKFLOW_CYCLES = 8;

function requireCheckpoint(checkpointed: boolean, name: string): void {
  if (!checkpointed) throw new FatalError(`Refresh checkpoint rejected: ${name}`);
}

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
          sourceForAttempt = {
            ...sourceForAttempt,
            status: "pending",
            attemptCount: recovery.attemptCount,
          };
        }

        const result =
          sourceForAttempt.status === "saved"
            ? {
                status: "saved" as const,
                resultCount: sourceForAttempt.resultCount ?? 0,
                attemptCount: sourceForAttempt.attemptCount,
              }
            : await collectSourceCandidatesStep(jobId, executionToken, source.sourceId);
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
          await refreshSourceRecencyStep(
            jobId,
            executionToken,
            source.sourceId,
            result.attemptCount,
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

    let failedBatches = 0;
    const runBatchUntilTerminal = async (batchId: string): Promise<void> => {
      let rateLimitWaitCycles = 0;
      for (let batchCycle = 0; batchCycle < MAX_BATCH_WORKFLOW_CYCLES; batchCycle++) {
        const result = await scoreCandidateBatchStep(jobId, executionToken, batchId);
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
          continue;
        }
        if (result.kind === "unknown") {
          const recovery = await recoverUnknownCandidateBatchStep(jobId, executionToken, batchId);
          if (recovery === "retry") {
            await sleep(1_000);
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
        const saved = await scoreCandidateBatchStep(jobId, executionToken, batchId);
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
    for (const batch of await listCandidateBatchesStep(jobId, executionToken)) {
      if (batch.status === "saved") continue;
      await runBatchUntilTerminal(batch.id);
    }

    // Freeze after collection so duplicate URLs have a deterministic representative.
    const pendingBeforeFullBatches = await listRefreshJobCandidatesStep(jobId, executionToken, [
      "pending",
    ]);
    const pendingBySignature = new Map<string, number>();
    for (const candidate of pendingBeforeFullBatches) {
      pendingBySignature.set(
        candidate.scoringSignature,
        (pendingBySignature.get(candidate.scoringSignature) ?? 0) + 1,
      );
    }
    const maxFullBatches = [...pendingBySignature.values()].reduce(
      (sum, count) => sum + Math.floor(count / 50),
      0,
    );
    for (let batchIndex = 0; batchIndex < maxFullBatches; batchIndex++) {
      const batchId = await freezeCandidateBatchStep(jobId, executionToken, false);
      if (!batchId) break;
      await runBatchUntilTerminal(batchId);
    }
    // All source collection is complete; now persist the final 1–49 item batch.
    for (let batchIndex = 0; batchIndex < pendingBySignature.size; batchIndex++) {
      const batchId = await freezeCandidateBatchStep(jobId, executionToken, true);
      if (!batchId) break;
      await runBatchUntilTerminal(batchId);
    }
    const remainingCandidates = await listRefreshJobCandidatesStep(jobId, executionToken, [
      "pending",
    ]);
    if (remainingCandidates.length > 0) {
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
    await reconcileJobStep(jobId, executionToken, "workflow-requires-reconciliation");
    if (error instanceof FatalError) throw error;
    throw new FatalError("Refresh workflow requires reconciliation");
  }
}
