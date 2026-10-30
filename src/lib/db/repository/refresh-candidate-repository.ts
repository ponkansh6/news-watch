import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, max, min, sql } from "drizzle-orm";
import { SOURCE_IDS, type SourceId } from "@/lib/news/registry";
import { db } from "../index";
import { refreshJobBatches, refreshJobCandidates, refreshJobs, refreshJobSources } from "../schema";

export type CandidateStatus = "pending" | "batched" | "saved" | "failed";
export type CandidateBatchStatus =
  | "pending"
  | "running"
  | "result_ready"
  | "saved"
  | "failed"
  | "unknown";
export type RefreshJobCandidate = typeof refreshJobCandidates.$inferSelect;
export type RefreshJobCandidateBatch = typeof refreshJobBatches.$inferSelect;

export interface RefreshArticleProgress {
  candidateTotal: number;
  savedCount: number;
  failedCount: number;
  collectionComplete: boolean;
}

export interface RefreshCandidateInput {
  sourceId: SourceId;
  /** Payload remains in the DB; Workflow events should carry candidate IDs only. */
  payload: Record<string, unknown>;
  contentHash: string;
  scoringSignature: string;
}

const DEFAULT_BATCH_SIZE = 50;

export interface PendingCandidateSignatureSummary {
  scoringSignature: string;
  candidateCount: number;
  firstOrdinal: number;
}

/** Summarize pending rows without loading their persisted article payloads. */
export async function summarizePendingCandidateSignatures(
  jobId: string,
  executionToken: string,
): Promise<PendingCandidateSignatureSummary[]> {
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job || job.ownerTokenHash !== tokenHash(executionToken))
    throw new Error("refresh_job_not_owned");
  const rows = await db
    .select({
      scoringSignature: refreshJobCandidates.scoringSignature,
      candidateCount: count(),
      firstOrdinal: min(refreshJobCandidates.ordinal),
    })
    .from(refreshJobCandidates)
    .where(and(eq(refreshJobCandidates.jobId, jobId), eq(refreshJobCandidates.status, "pending")))
    .groupBy(refreshJobCandidates.scoringSignature)
    .orderBy(min(refreshJobCandidates.ordinal));
  return rows.map((row) => ({
    scoringSignature: row.scoringSignature,
    candidateCount: row.candidateCount,
    firstOrdinal: row.firstOrdinal ?? 0,
  }));
}

/** Counts normalized, deduplicated candidates without loading their article payloads. */
export async function getRefreshArticleProgress(
  jobId: string,
): Promise<RefreshArticleProgress | null> {
  const [job] = await db
    .select({ status: refreshJobs.status })
    .from(refreshJobs)
    .where(eq(refreshJobs.id, jobId));
  if (!job) return null;

  const [candidateCounts] = await db
    .select({
      candidateTotal: count(),
      savedCount: sql<number>`coalesce(sum(case when ${refreshJobCandidates.status} = 'saved' then 1 else 0 end), 0)`,
      failedCount: sql<number>`coalesce(sum(case when ${refreshJobCandidates.status} = 'failed' then 1 else 0 end), 0)`,
    })
    .from(refreshJobCandidates)
    .where(eq(refreshJobCandidates.jobId, jobId));
  const [sourceCounts] = await db
    .select({
      sourceTotal: count(),
      terminalCount: sql<number>`coalesce(sum(case when ${refreshJobSources.status} in ('saved', 'invalidated', 'failed') then 1 else 0 end), 0)`,
    })
    .from(refreshJobSources)
    .where(eq(refreshJobSources.jobId, jobId));

  return {
    candidateTotal: candidateCounts?.candidateTotal ?? 0,
    savedCount: candidateCounts?.savedCount ?? 0,
    failedCount: candidateCounts?.failedCount ?? 0,
    collectionComplete:
      (sourceCounts?.sourceTotal ?? 0) === 0
        ? ["completed", "partial", "failed"].includes(job.status)
        : sourceCounts?.terminalCount === sourceCounts?.sourceTotal,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function canonicalizeUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("candidate_url_required");
  try {
    return new URL(value).href.toLowerCase();
  } catch {
    throw new Error("candidate_url_invalid");
  }
}

function stableSources(ids: string[]): SourceId[] {
  return [...new Set(ids)].filter((id): id is SourceId => SOURCE_IDS.includes(id as SourceId));
}

function sourcePriority(sourceId: string): number {
  const index = SOURCE_IDS.indexOf(sourceId as SourceId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function safeErrorCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(normalized) ? normalized : "unknown_error";
}

/** Persist selected candidates. Repeated source collection is idempotent by normalized URL. */
export async function stageRefreshCandidates(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  candidates: RefreshCandidateInput[],
  sourceCheckpoint: { sourceAttemptCount: number; resultCount?: number; savedAt?: string },
): Promise<{ inserted: number; merged: number }> {
  if (!SOURCE_IDS.includes(sourceId)) throw new Error("candidate_source_invalid");
  if (candidates.length > DEFAULT_BATCH_SIZE) throw new Error("candidate_source_budget_exceeded");
  const now = sourceCheckpoint?.savedAt ?? new Date().toISOString();

  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");

    const [sourceAttempt] = await tx
      .select({ status: refreshJobSources.status, attemptCount: refreshJobSources.attemptCount })
      .from(refreshJobSources)
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.status, "executing"),
          eq(refreshJobSources.attemptCount, sourceCheckpoint.sourceAttemptCount),
        ),
      );
    if (!sourceAttempt) throw new Error("refresh_source_attempt_fenced");

    if (sourceCheckpoint.resultCount !== undefined) {
      const checkpoint = await tx
        .update(refreshJobSources)
        .set({
          status: "saved",
          resultCount: sourceCheckpoint.resultCount,
          errorCode: null,
          savedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(refreshJobSources.jobId, jobId),
            eq(refreshJobSources.sourceId, sourceId),
            eq(refreshJobSources.status, "executing"),
            eq(refreshJobSources.attemptCount, sourceCheckpoint.sourceAttemptCount),
            sql`${refreshJobSources.adapterStartedAt} IS NOT NULL`,
          ),
        )
        .returning({ sourceId: refreshJobSources.sourceId });
      if (checkpoint.length !== 1) throw new Error("refresh_source_checkpoint_rejected");
      await tx
        .update(refreshJobs)
        .set({
          currentSourceId: sourceId,
          revision: job.revision + 1,
          updatedAt: now,
        })
        .where(eq(refreshJobs.id, jobId));
    }

    const existingRows = await tx
      .select({
        normalizedUrl: refreshJobCandidates.normalizedUrl,
        sourceIdsJson: refreshJobCandidates.sourceIdsJson,
      })
      .from(refreshJobCandidates)
      .where(eq(refreshJobCandidates.jobId, jobId));
    const sourcesByUrl = new Map(
      existingRows.map((row) => [
        row.normalizedUrl,
        stableSources(JSON.parse(row.sourceIdsJson) as string[]),
      ]),
    );
    const incomingUrls = new Set<string>();
    for (const input of candidates) {
      if (input.sourceId !== sourceId) throw new Error("candidate_source_mismatch");
      incomingUrls.add(canonicalizeUrl(input.payload.url));
    }
    const sourceCount = existingRows.filter((row) =>
      sourcesByUrl.get(row.normalizedUrl)?.includes(sourceId),
    ).length;
    const additions = [...incomingUrls].filter(
      (url) => !sourcesByUrl.get(url)?.includes(sourceId),
    ).length;
    if (sourceCount + additions > DEFAULT_BATCH_SIZE)
      throw new Error("candidate_source_budget_exceeded");

    let inserted = 0;
    let merged = 0;
    for (const input of candidates) {
      if (input.sourceId !== sourceId) throw new Error("candidate_source_mismatch");
      const normalizedUrl = canonicalizeUrl(input.payload.url);
      const existing = await tx
        .select()
        .from(refreshJobCandidates)
        .where(
          and(
            eq(refreshJobCandidates.jobId, jobId),
            eq(refreshJobCandidates.normalizedUrl, normalizedUrl),
          ),
        );
      const row = existing[0];
      if (row) {
        const sourceIds = stableSources([...JSON.parse(row.sourceIdsJson), sourceId]);
        const useIncoming =
          row.status === "pending" &&
          sourcePriority(sourceId) < sourcePriority(row.representativeSourceId);
        await tx
          .update(refreshJobCandidates)
          .set({
            sourceIdsJson: JSON.stringify(sourceIds),
            ...(useIncoming
              ? {
                  payloadJson: JSON.stringify(input.payload),
                  contentHash: input.contentHash,
                  scoringSignature: input.scoringSignature,
                  representativeSourceId: sourceId,
                }
              : {}),
            updatedAt: now,
          })
          .where(eq(refreshJobCandidates.id, row.id));
        merged++;
        continue;
      }

      const [{ maxOrdinal }] = await tx
        .select({ maxOrdinal: max(refreshJobCandidates.ordinal) })
        .from(refreshJobCandidates)
        .where(eq(refreshJobCandidates.jobId, jobId));
      // Ordinals are globally stable within a job and only used to freeze batch order.
      const ordinal = (maxOrdinal ?? -1) + 1;
      await tx.insert(refreshJobCandidates).values({
        id: randomUUID(),
        jobId,
        normalizedUrl,
        payloadJson: JSON.stringify(input.payload),
        contentHash: input.contentHash,
        scoringSignature: input.scoringSignature,
        representativeSourceId: sourceId,
        sourceIdsJson: JSON.stringify([sourceId]),
        ordinal,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
    return { inserted, merged };
  });
}

/** Freeze exactly 50 pending candidates, or the final 1–49 when flushTail is true. */
export async function freezeNextCandidateBatch(
  jobId: string,
  executionToken: string,
  scoringSignature: string,
  flushTail = false,
): Promise<RefreshJobCandidateBatch | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");

    const pending = await tx
      .select({ id: refreshJobCandidates.id, ordinal: refreshJobCandidates.ordinal })
      .from(refreshJobCandidates)
      .where(
        and(
          eq(refreshJobCandidates.jobId, jobId),
          eq(refreshJobCandidates.status, "pending"),
          eq(refreshJobCandidates.scoringSignature, scoringSignature),
        ),
      )
      .orderBy(asc(refreshJobCandidates.ordinal))
      .limit(DEFAULT_BATCH_SIZE);
    if (pending.length < DEFAULT_BATCH_SIZE && (!flushTail || pending.length === 0)) return null;
    const selected = pending.slice(0, DEFAULT_BATCH_SIZE);
    if (selected.length < DEFAULT_BATCH_SIZE && !flushTail) return null;

    const [batchOrdinal] = await tx
      .select({ ordinal: max(refreshJobBatches.ordinal) })
      .from(refreshJobBatches)
      .where(eq(refreshJobBatches.jobId, jobId));
    const ordinal = (batchOrdinal?.ordinal ?? -1) + 1;
    const now = new Date().toISOString();
    const batch = {
      id: randomUUID(),
      jobId,
      ordinal,
      candidateIdsJson: JSON.stringify(selected.map((candidate) => candidate.id)),
      scoringSignature,
      status: "pending" as const,
      resultJson: null,
      attemptCount: 0,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await tx.insert(refreshJobBatches).values(batch);
    const selectedIds = selected.map((candidate) => candidate.id);
    const changed = await tx
      .update(refreshJobCandidates)
      .set({ status: "batched", batchId: batch.id, updatedAt: now })
      .where(
        and(
          inArray(refreshJobCandidates.id, selectedIds),
          eq(refreshJobCandidates.jobId, jobId),
          eq(refreshJobCandidates.scoringSignature, scoringSignature),
          eq(refreshJobCandidates.status, "pending"),
        ),
      )
      .returning({ id: refreshJobCandidates.id });
    if (
      changed.length !== selectedIds.length ||
      new Set(changed.map((row) => row.id)).size !== selectedIds.length ||
      selectedIds.some((id) => !changed.some((row) => row.id === id))
    ) {
      throw new Error("candidate_batch_membership_update_mismatch");
    }
    return batch;
  });
}

/** A batch is claimed once; running batches are never silently reclaimed after a crash. */
export async function claimCandidateBatch(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<RefreshJobCandidateBatch | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const changed = await tx
      .update(refreshJobBatches)
      .set({
        status: "running",
        attemptCount: sql`${refreshJobBatches.attemptCount} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(refreshJobBatches.id, batchId),
          eq(refreshJobBatches.jobId, jobId),
          eq(refreshJobBatches.status, "pending"),
        ),
      )
      .returning();
    return changed[0] ?? null;
  });
}

/** Return a claimed batch to pending when the shared rate limiter refused before HTTP. */
export async function deferCandidateBatchForRateLimit(
  jobId: string,
  executionToken: string,
  batchId: string,
  consumedAttempt: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const changed = await tx
      .update(refreshJobBatches)
      .set({
        status: "pending",
        attemptCount: consumedAttempt
          ? refreshJobBatches.attemptCount
          : sql`max(${refreshJobBatches.attemptCount} - 1, 0)`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(refreshJobBatches.id, batchId),
          eq(refreshJobBatches.jobId, jobId),
          eq(refreshJobBatches.status, "running"),
        ),
      )
      .returning({ id: refreshJobBatches.id });
    return changed.length === 1;
  });
}

export async function getCandidateBatch(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<RefreshJobCandidateBatch | null> {
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job || job.ownerTokenHash !== tokenHash(executionToken))
    throw new Error("refresh_job_not_owned");
  const [row] = await db
    .select()
    .from(refreshJobBatches)
    .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.jobId, jobId)));
  return row ?? null;
}

export async function getBatchCandidates(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<RefreshJobCandidate[]> {
  const batch = await getCandidateBatch(jobId, executionToken, batchId);
  if (!batch) return [];
  const ids = JSON.parse(batch.candidateIdsJson) as string[];
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(refreshJobCandidates)
    .where(eq(refreshJobCandidates.batchId, batchId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is RefreshJobCandidate => Boolean(row));
}

/** Persist the validated response before article upserts, so replay can finish without re-calling Gemini. */
export async function storeCandidateBatchResult(
  jobId: string,
  executionToken: string,
  batchId: string,
  resultByCandidateId: Record<string, unknown>,
  expectedAttemptCount: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const [batch] = await tx
      .select()
      .from(refreshJobBatches)
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.jobId, jobId)));
    if (!batch || batch.status !== "running" || batch.attemptCount !== expectedAttemptCount)
      return false;
    const ids = JSON.parse(batch.candidateIdsJson) as string[];
    if (
      ids.length !== Object.keys(resultByCandidateId).length ||
      ids.some((id) => !(id in resultByCandidateId))
    ) {
      throw new Error("candidate_batch_result_ids_mismatch");
    }
    const changed = await tx
      .update(refreshJobBatches)
      .set({
        status: "result_ready",
        resultJson: JSON.stringify(resultByCandidateId),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(refreshJobBatches.id, batchId),
          eq(refreshJobBatches.status, "running"),
          eq(refreshJobBatches.attemptCount, expectedAttemptCount),
        ),
      )
      .returning({ id: refreshJobBatches.id });
    return changed.length === 1;
  });
}

/** Mark candidates and their immutable batch saved after idempotent article persistence. */
export async function markCandidateBatchSaved(
  jobId: string,
  executionToken: string,
  batchId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const [batch] = await tx
      .select()
      .from(refreshJobBatches)
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.jobId, jobId)));
    if (!batch || batch.status !== "result_ready") return false;
    const now = new Date().toISOString();
    await tx
      .update(refreshJobCandidates)
      .set({ status: "saved", errorCode: null, updatedAt: now })
      .where(eq(refreshJobCandidates.batchId, batchId));
    const changed = await tx
      .update(refreshJobBatches)
      .set({ status: "saved", completedAt: now, updatedAt: now })
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.status, "result_ready")))
      .returning({ id: refreshJobBatches.id });
    return changed.length === 1;
  });
}

export async function markCandidateBatchFailed(
  jobId: string,
  executionToken: string,
  batchId: string,
  errorCode: string,
  expectedAttemptCount?: number,
): Promise<boolean> {
  return setBatchState(
    jobId,
    executionToken,
    batchId,
    ["pending", "running"],
    "failed",
    errorCode,
    expectedAttemptCount,
  );
}

/** Requeue the same immutable membership only while the configured attempt budget remains. */
export async function retryFailedCandidateBatch(
  jobId: string,
  executionToken: string,
  batchId: string,
  maxAttempts = 2,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const [batch] = await tx
      .select()
      .from(refreshJobBatches)
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.jobId, jobId)));
    if (!batch || batch.status !== "failed" || batch.attemptCount >= maxAttempts) return false;
    const now = new Date().toISOString();
    await tx
      .update(refreshJobCandidates)
      .set({ status: "batched", errorCode: null, updatedAt: now })
      .where(
        and(eq(refreshJobCandidates.batchId, batchId), eq(refreshJobCandidates.status, "failed")),
      );
    const changed = await tx
      .update(refreshJobBatches)
      .set({ status: "pending", errorCode: null, updatedAt: now })
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.status, "failed")))
      .returning({ id: refreshJobBatches.id });
    return changed.length === 1;
  });
}

export async function markCandidateBatchUnknown(
  jobId: string,
  executionToken: string,
  batchId: string,
  errorCode: string,
  expectedAttemptCount?: number,
): Promise<boolean> {
  return setBatchState(
    jobId,
    executionToken,
    batchId,
    ["running"],
    "unknown",
    errorCode,
    expectedAttemptCount,
  );
}

/** Retry an ambiguous batch result a finite number of times using its frozen ID membership. */
export async function recoverUnknownCandidateBatch(
  jobId: string,
  executionToken: string,
  batchId: string,
  maxAttempts = 2,
): Promise<"retry" | "failed" | "not-claimable"> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const [batch] = await tx
      .select()
      .from(refreshJobBatches)
      .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.jobId, jobId)));
    if (!batch || batch.status !== "unknown") return "not-claimable";

    const now = new Date().toISOString();
    if (batch.attemptCount >= maxAttempts) {
      await tx
        .update(refreshJobCandidates)
        .set({ status: "failed", errorCode: "candidate-batch-retry-exhausted", updatedAt: now })
        .where(eq(refreshJobCandidates.batchId, batchId));
      await tx
        .update(refreshJobBatches)
        .set({
          status: "failed",
          errorCode: "candidate-batch-retry-exhausted",
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(refreshJobBatches.id, batchId), eq(refreshJobBatches.status, "unknown")));
      return "failed";
    }

    await tx
      .update(refreshJobCandidates)
      .set({ status: "batched", errorCode: null, updatedAt: now })
      .where(eq(refreshJobCandidates.batchId, batchId));
    const changed = await tx
      .update(refreshJobBatches)
      .set({ status: "pending", errorCode: null, updatedAt: now })
      .where(
        and(
          eq(refreshJobBatches.id, batchId),
          eq(refreshJobBatches.status, "unknown"),
          eq(refreshJobBatches.attemptCount, batch.attemptCount),
        ),
      )
      .returning({ id: refreshJobBatches.id });
    return changed.length === 1 ? "retry" : "not-claimable";
  });
}

async function setBatchState(
  jobId: string,
  executionToken: string,
  batchId: string,
  from: CandidateBatchStatus[],
  status: "failed" | "unknown",
  errorCode: string,
  expectedAttemptCount?: number,
): Promise<boolean> {
  const sanitized = safeErrorCode(errorCode);
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash(executionToken))
      throw new Error("refresh_job_not_owned");
    if (job.status !== "running") throw new Error("refresh_job_not_active");
    const conditions = [
      eq(refreshJobBatches.id, batchId),
      eq(refreshJobBatches.jobId, jobId),
      inArray(refreshJobBatches.status, from),
    ];
    if (expectedAttemptCount !== undefined) {
      conditions.push(eq(refreshJobBatches.attemptCount, expectedAttemptCount));
    }
    const changed = await tx
      .update(refreshJobBatches)
      .set({ status, errorCode: sanitized, updatedAt: now })
      .where(and(...conditions))
      .returning({ id: refreshJobBatches.id });
    if (changed.length === 1 && status === "failed") {
      await tx
        .update(refreshJobCandidates)
        .set({ status: "failed", errorCode: sanitized, updatedAt: now })
        .where(eq(refreshJobCandidates.batchId, batchId));
    }
    return changed.length === 1;
  });
}

export async function listCandidateBatches(
  jobId: string,
  executionToken: string,
): Promise<RefreshJobCandidateBatch[]> {
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job || job.ownerTokenHash !== tokenHash(executionToken))
    throw new Error("refresh_job_not_owned");
  return db
    .select()
    .from(refreshJobBatches)
    .where(eq(refreshJobBatches.jobId, jobId))
    .orderBy(asc(refreshJobBatches.ordinal));
}

export async function listRefreshJobCandidates(
  jobId: string,
  executionToken: string,
  statuses?: CandidateStatus[],
): Promise<RefreshJobCandidate[]> {
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job || job.ownerTokenHash !== tokenHash(executionToken))
    throw new Error("refresh_job_not_owned");
  const rows = await db
    .select()
    .from(refreshJobCandidates)
    .where(eq(refreshJobCandidates.jobId, jobId))
    .orderBy(asc(refreshJobCandidates.ordinal));
  return statuses ? rows.filter((row) => statuses.includes(row.status)) : rows;
}
