import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../index";
import { refreshJobBatches, refreshJobs, refreshJobSources } from "../schema";

export type TerminalWorkflowStatus = "completed" | "failed" | "cancelled";

export type ReconcileRefreshJobResult =
  | {
      kind: "reconciled";
      status: "completed" | "partial" | "failed";
      invalidatedCount: number;
      skippedCount: number;
    }
  | {
      kind:
        | "not_found"
        | "wrong_state"
        | "unsafe_checkpoint"
        | "unsafe_candidate_batch"
        | "changed";
    };

/**
 * Finalizes a held job only after the caller has independently confirmed the
 * linked Workflow run is terminal. The run ID, job state, and slot owner are
 * checked again inside the atomic write batch. This function never starts or
 * repeats source work.
 */
export async function reconcileTerminalRefreshJob(
  jobId: string,
  expectedWorkflowRunId: string,
  terminalRunStatus: TerminalWorkflowStatus,
  at = new Date().toISOString(),
): Promise<ReconcileRefreshJobResult> {
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job) return { kind: "not_found" };
  if (
    job.status !== "needs_reconciliation" ||
    job.workflowRunId !== expectedWorkflowRunId ||
    !["completed", "failed", "cancelled"].includes(terminalRunStatus)
  )
    return { kind: "wrong_state" };

  const sources = await db
    .select()
    .from(refreshJobSources)
    .where(eq(refreshJobSources.jobId, jobId))
    .orderBy(asc(refreshJobSources.ordinal));
  const unfinishedBatches = await db
    .select({ id: refreshJobBatches.id })
    .from(refreshJobBatches)
    .where(
      and(
        eq(refreshJobBatches.jobId, jobId),
        inArray(refreshJobBatches.status, ["pending", "running", "result_ready", "unknown"]),
      ),
    );
  if (unfinishedBatches.length > 0) return { kind: "unsafe_candidate_batch" };
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(job.sourceIds);
  } catch {
    return { kind: "unsafe_checkpoint" };
  }
  if (
    !Array.isArray(snapshot) ||
    snapshot.length === 0 ||
    snapshot.some((sourceId) => typeof sourceId !== "string" || sourceId.length === 0) ||
    new Set(snapshot).size !== snapshot.length ||
    sources.length !== snapshot.length ||
    sources.some(
      (source, index) => source.ordinal !== index || source.sourceId !== snapshot[index],
    ) ||
    sources.some((source) => source.status === "executing" || source.status === "unknown") ||
    sources.some((source) => !["pending", "saved", "invalidated", "failed"].includes(source.status))
  )
    return { kind: "unsafe_checkpoint" };

  const saved = sources.filter((source) => source.status === "saved").length;
  const pending = sources.filter((source) => source.status === "pending").length;
  const invalidated = sources.filter((source) => source.status === "invalidated").length;
  const existingFailed = sources.filter(
    (source) => source.status === "failed" || source.errorCode !== null,
  ).length;
  const successful = invalidated + saved;
  const unsuccessful = pending + existingFailed;
  const terminalStatus =
    successful === 0
      ? "failed"
      : terminalRunStatus === "completed" && unsuccessful === 0
        ? "completed"
        : "partial";

  const ownerCondition = `EXISTS (
    SELECT 1 FROM refresh_job_slot AS slot
    WHERE slot.id = 1
      AND slot.owner_kind = 'job'
      AND slot.owner_id = ?
      AND slot.owner_token_hash = refresh_jobs.owner_token_hash
  )`;
  const sourceOrderCondition = `source_ids = ?
    AND (SELECT COUNT(*) FROM refresh_job_sources WHERE job_id = refresh_jobs.id) = ?
    AND NOT EXISTS (
      SELECT 1 FROM refresh_job_sources AS checkpoint
      WHERE checkpoint.job_id = refresh_jobs.id
        AND NOT (${sources
          .map(() => `(checkpoint.source_id = ? AND checkpoint.ordinal = ?)`)
          .join(" OR ")})
    )`;
  const jobCondition = `id = ?
    AND status = 'needs_reconciliation'
    AND workflow_run_id = ?
    AND ${ownerCondition}
    AND ${sourceOrderCondition}
    AND NOT EXISTS (
      SELECT 1 FROM refresh_job_sources AS source
      WHERE source.job_id = refresh_jobs.id
        AND source.status IN ('executing', 'unknown')
    )
    AND NOT EXISTS (
      SELECT 1 FROM refresh_job_batches AS batch
      WHERE batch.job_id = refresh_jobs.id
        AND batch.status IN ('pending', 'running', 'result_ready', 'unknown')
    )`;
  const jobConditionArgs = [
    jobId,
    expectedWorkflowRunId,
    jobId,
    job.sourceIds,
    sources.length,
    ...sources.flatMap((source) => [source.sourceId, source.ordinal]),
  ];
  const results = await db.$client.batch(
    [
      {
        sql: `UPDATE refresh_job_sources
              SET status = 'invalidated', cache_invalidated_at = ?, updated_at = ?
              WHERE job_id = ? AND status = 'saved'
                AND EXISTS (
                  SELECT 1 FROM refresh_jobs
                  WHERE ${jobCondition}
                )`,
        args: [at, at, jobId, ...jobConditionArgs],
      },
      {
        sql: `UPDATE refresh_job_sources
              SET status = 'failed', error_code = 'workflow-terminated', completed_at = ?, updated_at = ?
              WHERE job_id = ? AND status = 'pending'
                AND EXISTS (
                  SELECT 1 FROM refresh_jobs
                  WHERE ${jobCondition}
                )`,
        args: [at, at, jobId, ...jobConditionArgs],
      },
      {
        sql: `UPDATE refresh_jobs
              SET status = CASE
                    WHEN ? = 'completed' AND EXISTS (
                      SELECT 1 FROM refresh_job_sources
                      WHERE job_id = refresh_jobs.id AND status = 'invalidated'
                    ) AND NOT EXISTS (
                      SELECT 1 FROM refresh_job_sources
                      WHERE job_id = refresh_jobs.id
                        AND (status = 'failed' OR error_code IS NOT NULL)
                    ) THEN 'completed'
                    WHEN EXISTS (
                      SELECT 1 FROM refresh_job_sources
                      WHERE job_id = refresh_jobs.id AND status = 'invalidated'
                    ) THEN 'partial'
                    ELSE 'failed'
                  END,
                  error_code = 'workflow-terminated',
                  completed_at = ?, revision = revision + 1, updated_at = ?
              WHERE ${jobCondition}
                AND NOT EXISTS (
                  SELECT 1 FROM refresh_job_sources
                  WHERE job_id = refresh_jobs.id AND status = 'saved'
                )`,
        args: [terminalRunStatus, at, at, ...jobConditionArgs],
      },
      {
        sql: `UPDATE refresh_job_slot
              SET owner_kind = NULL, owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL
              WHERE id = 1 AND owner_kind = 'job' AND owner_id = ?
                AND EXISTS (
                  SELECT 1 FROM refresh_jobs
                  WHERE id = ? AND status IN ('completed', 'partial', 'failed')
                    AND workflow_run_id = ?
                    AND owner_token_hash = refresh_job_slot.owner_token_hash
                )
                AND NOT EXISTS (
                  SELECT 1 FROM refresh_job_sources
                  WHERE job_id = ? AND status IN ('saved', 'executing', 'unknown', 'pending')
                )
                AND NOT EXISTS (
                  SELECT 1 FROM refresh_job_batches
                  WHERE job_id = ? AND status IN ('pending', 'running', 'result_ready', 'unknown')
                )`,
        args: [jobId, jobId, expectedWorkflowRunId, jobId, jobId],
      },
    ],
    "write",
  );

  if ((results[2]?.rowsAffected ?? 0) !== 1 || (results[3]?.rowsAffected ?? 0) !== 1) {
    return { kind: "changed" };
  }
  return {
    kind: "reconciled",
    status: terminalStatus,
    invalidatedCount: saved,
    skippedCount: pending + existingFailed,
  };
}
