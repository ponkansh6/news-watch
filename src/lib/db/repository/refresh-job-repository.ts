import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { SOURCE_IDS, type SourceId } from "@/lib/news/registry";
import { db } from "../index";
import { refreshJobSlot, refreshJobs, refreshJobSources } from "../schema";

export type RefreshJobStatus =
  | "enqueue_unknown"
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "needs_reconciliation";
export type RefreshSourceStatus =
  | "pending"
  | "executing"
  | "saved"
  | "invalidated"
  | "failed"
  | "unknown";

export type RefreshJobRow = typeof refreshJobs.$inferSelect;
export type RefreshJobSourceRow = typeof refreshJobSources.$inferSelect;

const ACTIVE_SLOT_ID = 1;
const SHARED_ADMIN_OWNER = "shared-admin";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeErrorCode(errorCode: string): string {
  const normalized = errorCode.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(normalized) ? normalized : "unknown_error";
}

function isTerminal(status: RefreshJobStatus): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

export interface StartAggregateResult {
  kind: "created" | "joined" | "busy";
  job: RefreshJobRow | null;
  executionToken?: string;
}

/**
 * Atomically claims the shared refresh slot and snapshots the registry-ordered
 * source list. An occupied job is joined; an occupied single-source refresh is
 * returned as busy. The plaintext execution token is returned only at creation.
 */
export async function startAggregateJob(): Promise<StartAggregateResult> {
  const id = randomUUID();
  const executionToken = makeToken();
  const ownerTokenHash = hashToken(executionToken);
  const now = nowIso();

  const statements = [
    {
      sql: "INSERT INTO refresh_job_slot (id) VALUES (?) ON CONFLICT(id) DO NOTHING",
      args: [ACTIVE_SLOT_ID],
    },
    {
      sql: `UPDATE refresh_job_slot
            SET owner_kind = 'job', owner_id = ?, owner_token_hash = ?, acquired_at = ?,
                lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
            WHERE id = ? AND owner_id IS NULL`,
      args: [id, ownerTokenHash, now, ACTIVE_SLOT_ID],
    },
    {
      sql: `INSERT INTO refresh_jobs
            (id, owner_id, owner_token_hash, source_ids, status, current_source_id, revision, created_at, updated_at)
            SELECT ?, ?, ?, ?, 'enqueue_unknown', ?, 0, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM refresh_job_slot
              WHERE id = ? AND owner_kind = 'job' AND owner_id = ? AND owner_token_hash = ?
            )`,
      args: [
        id,
        SHARED_ADMIN_OWNER,
        ownerTokenHash,
        JSON.stringify(SOURCE_IDS),
        SOURCE_IDS[0] ?? null,
        now,
        now,
        ACTIVE_SLOT_ID,
        id,
        ownerTokenHash,
      ],
    },
    ...SOURCE_IDS.map((sourceId, ordinal) => ({
      sql: `INSERT INTO refresh_job_sources (job_id, source_id, ordinal, status, updated_at)
            SELECT ?, ?, ?, 'pending', ?
            WHERE EXISTS (SELECT 1 FROM refresh_jobs WHERE id = ? AND owner_token_hash = ?)`,
      args: [id, sourceId, ordinal, now, id, ownerTokenHash],
    })),
  ];
  await db.$client.batch(statements, "write");

  const [created] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, id));
  if (created) return { kind: "created", job: created, executionToken };

  const [slot] = await db
    .select()
    .from(refreshJobSlot)
    .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
  if (slot?.ownerKind === "job" && slot.ownerId) {
    const [activeJob] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, slot.ownerId));
    return activeJob ? { kind: "joined", job: activeJob } : { kind: "busy", job: null };
  }
  return { kind: "busy", job: null };
}

export interface SingleRefreshClaim {
  kind: "claimed" | "busy";
  ownerId?: string;
  ownerToken?: string;
}

export type SingleRefreshLeaseEvidence =
  | { kind: "request-60-v1"; deploymentId: string }
  | { kind: "unknown" };

/** Claims the same singleton slot for an existing single-source caller. */
export async function claimSingleRefresh(
  lease: SingleRefreshLeaseEvidence = { kind: "unknown" },
): Promise<SingleRefreshClaim> {
  const ownerId = `single:${randomUUID()}`;
  const ownerToken = makeToken();
  const ownerTokenHash = hashToken(ownerToken);
  const knownLease = lease.kind === "request-60-v1" && lease.deploymentId.trim().length > 0;
  const leaseKind = knownLease ? lease.kind : "unknown";
  const deploymentId = knownLease ? lease.deploymentId : null;
  const recoveryAfter = knownLease
    ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+120 seconds')"
    : "NULL";

  const result = await db.$client.batch(
    [
      {
        sql: "INSERT INTO refresh_job_slot (id) VALUES (?) ON CONFLICT(id) DO NOTHING",
        args: [ACTIVE_SLOT_ID],
      },
      {
        // Only a positively identified Vercel 60s request lease can expire.
        // Null/legacy evidence is intentionally permanent until its owner releases it.
        sql: `UPDATE refresh_job_slot
              SET owner_kind = NULL, owner_id = NULL, owner_token_hash = NULL,
                  acquired_at = NULL, lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
              WHERE id = ? AND owner_kind = 'single' AND owner_id IS NOT NULL
                AND lease_kind = 'request-60-v1'
                AND deployment_id IS NOT NULL AND length(deployment_id) > 0
                AND recovery_after IS NOT NULL
                AND julianday(recovery_after) <= julianday('now')`,
        args: [ACTIVE_SLOT_ID],
      },
      {
        sql: `UPDATE refresh_job_slot
              SET owner_kind = 'single', owner_id = ?, owner_token_hash = ?,
                  acquired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                  lease_kind = ?, deployment_id = ?, recovery_after = ${recoveryAfter}
              WHERE id = ? AND owner_id IS NULL`,
        args: [ownerId, ownerTokenHash, leaseKind, deploymentId, ACTIVE_SLOT_ID],
      },
      {
        sql: "SELECT owner_kind, owner_id, owner_token_hash FROM refresh_job_slot WHERE id = ?",
        args: [ACTIVE_SLOT_ID],
      },
    ],
    "write",
  );
  const rawRow: unknown = result[3]?.rows[0];
  const row = rawRow as
    | { owner_kind: string | null; owner_id: string | null; owner_token_hash: string | null }
    | undefined;
  return row?.owner_kind === "single" &&
    row.owner_id === ownerId &&
    row.owner_token_hash === ownerTokenHash
    ? { kind: "claimed", ownerId, ownerToken }
    : { kind: "busy" };
}

/** Releases a single-source claim only when the caller still owns it. */
export async function releaseSingleRefresh(ownerId: string, ownerToken: string): Promise<boolean> {
  const changed = await db
    .update(refreshJobSlot)
    .set({
      ownerKind: null,
      ownerId: null,
      ownerTokenHash: null,
      acquiredAt: null,
      leaseKind: null,
      deploymentId: null,
      recoveryAfter: null,
    })
    .where(
      and(
        eq(refreshJobSlot.id, ACTIVE_SLOT_ID),
        eq(refreshJobSlot.ownerKind, "single"),
        eq(refreshJobSlot.ownerId, ownerId),
        eq(refreshJobSlot.ownerTokenHash, hashToken(ownerToken)),
      ),
    )
    .returning({ id: refreshJobSlot.id });
  return changed.length === 1;
}

/** Marks a request as safely awaiting reconciliation; callers must not re-start it. */
export async function markEnqueueUnknown(jobId: string, executionToken: string): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  const now = nowIso();
  const changed = await db
    .update(refreshJobs)
    .set({ status: "enqueue_unknown", updatedAt: now })
    .where(
      and(
        eq(refreshJobs.id, jobId),
        eq(refreshJobs.ownerTokenHash, tokenHash),
        eq(refreshJobs.status, "enqueue_unknown"),
        isNull(refreshJobs.workflowRunId),
      ),
    )
    .returning({ id: refreshJobs.id });
  return changed.length === 1;
}

/** Binds the first known SDK run ID, or idempotently accepts the same ID. */
export async function bindWorkflowRun(
  jobId: string,
  executionToken: string,
  workflowRunId: string,
): Promise<boolean> {
  const now = nowIso();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== hashToken(executionToken)) return false;
    if (!["enqueue_unknown", "queued", "running"].includes(job.status)) return false;

    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (
      slot?.ownerKind !== "job" ||
      slot.ownerId !== jobId ||
      slot.ownerTokenHash !== job.ownerTokenHash
    )
      return false;
    if (job.workflowRunId && job.workflowRunId !== workflowRunId) return false;

    const changed = await tx
      .update(refreshJobs)
      .set({
        workflowRunId,
        status: "running",
        startedAt: job.startedAt ?? now,
        revision: job.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(refreshJobs.id, jobId),
          eq(refreshJobs.ownerTokenHash, hashToken(executionToken)),
          or(isNull(refreshJobs.workflowRunId), eq(refreshJobs.workflowRunId, workflowRunId)),
        ),
      )
      .returning({ id: refreshJobs.id });
    return changed.length === 1;
  });
}

/** Holds the active slot for manual reconciliation without storing error details. */
export async function markNeedsReconciliation(
  jobId: string,
  executionToken: string,
  errorCode: string,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  const now = nowIso();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || isTerminal(job.status)) return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerKind !== "job" || slot.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) {
      return false;
    }
    if (job.status === "needs_reconciliation") return true;

    const changed = await tx
      .update(refreshJobs)
      .set({
        status: "needs_reconciliation",
        errorCode: sanitizeErrorCode(errorCode),
        revision: job.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(refreshJobs.id, jobId),
          eq(refreshJobs.ownerTokenHash, tokenHash),
          eq(refreshJobs.status, job.status),
          eq(refreshJobs.revision, job.revision),
        ),
      )
      .returning({ id: refreshJobs.id });
    return changed.length === 1;
  });
}

/** Returns a job only for its shared owner and secret execution token. */
export async function getOwnedRefreshJob(
  jobId: string,
  ownerId = SHARED_ADMIN_OWNER,
): Promise<RefreshJobRow | null> {
  const [job] = await db
    .select()
    .from(refreshJobs)
    .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerId, ownerId)));
  return job ?? null;
}

/** Claims a pending source once. Existing executing/unknown rows are never reclaimed. */
export async function claimRefreshSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
): Promise<RefreshJobSourceRow | null> {
  const now = nowIso();
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return null;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash || slot.ownerKind !== "job") {
      return null;
    }

    const sources = await tx
      .select()
      .from(refreshJobSources)
      .where(eq(refreshJobSources.jobId, jobId))
      .orderBy(asc(refreshJobSources.ordinal));
    const firstPending = sources.find((source) => source.status === "pending");
    if (
      !firstPending ||
      firstPending.sourceId !== sourceId ||
      sources.some((source) => source.status === "executing" || source.status === "unknown")
    )
      return null;

    const claimed = await tx
      .update(refreshJobSources)
      .set({
        status: "executing",
        attemptCount: sql`${refreshJobSources.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.status, "pending"),
        ),
      )
      .returning();
    if (claimed.length !== 1) return null;

    await tx
      .update(refreshJobs)
      .set({ currentSourceId: sourceId, revision: job.revision + 1, updatedAt: now })
      .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerTokenHash, tokenHash)));
    return claimed[0];
  });
}

export type RecoverRefreshSourceResult =
  | { kind: "retry"; attemptCount: number }
  | { kind: "failed"; attemptCount: number }
  | { kind: "unchanged" };

/**
 * Reopens an uncertain, read-only adapter fetch a bounded number of times.
 * Candidate persistence is idempotent and atomic with the saved checkpoint,
 * so a late duplicate fetch cannot overwrite a completed source.
 */
export async function recoverRefreshSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  expectedAttemptCount: number,
  maxAttempts = 2,
): Promise<RecoverRefreshSourceResult> {
  const now = nowIso();
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") {
      return { kind: "unchanged" };
    }
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash || slot.ownerKind !== "job") {
      return { kind: "unchanged" };
    }
    const [source] = await tx
      .select()
      .from(refreshJobSources)
      .where(and(eq(refreshJobSources.jobId, jobId), eq(refreshJobSources.sourceId, sourceId)));
    if (
      !source ||
      source.attemptCount !== expectedAttemptCount ||
      (source.status !== "executing" && source.status !== "unknown")
    ) {
      return { kind: "unchanged" };
    }

    if (source.attemptCount >= maxAttempts) {
      const changed = await tx
        .update(refreshJobSources)
        .set({
          status: "failed",
          errorCode: "source_retry_exhausted",
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(refreshJobSources.jobId, jobId),
            eq(refreshJobSources.sourceId, sourceId),
            eq(refreshJobSources.attemptCount, expectedAttemptCount),
            or(eq(refreshJobSources.status, "executing"), eq(refreshJobSources.status, "unknown")),
          ),
        )
        .returning({ sourceId: refreshJobSources.sourceId });
      if (changed.length !== 1) return { kind: "unchanged" };
      await tx
        .update(refreshJobs)
        .set({ revision: job.revision + 1, updatedAt: now })
        .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerTokenHash, tokenHash)));
      return { kind: "failed", attemptCount: source.attemptCount };
    }

    const changed = await tx
      .update(refreshJobSources)
      .set({ status: "pending", adapterStartedAt: null, errorCode: null, updatedAt: now })
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.attemptCount, expectedAttemptCount),
          or(eq(refreshJobSources.status, "executing"), eq(refreshJobSources.status, "unknown")),
        ),
      )
      .returning({ sourceId: refreshJobSources.sourceId });
    if (changed.length !== 1) return { kind: "unchanged" };
    await tx
      .update(refreshJobs)
      .set({ revision: job.revision + 1, updatedAt: now })
      .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerTokenHash, tokenHash)));
    return { kind: "retry", attemptCount: source.attemptCount };
  });
}

/** Persists the true adapter-call boundary timestamp before calling an adapter. */
export async function recordAdapterStart(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
  startedAt = nowIso(),
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) return false;
    const changed = await tx
      .update(refreshJobSources)
      .set({ adapterStartedAt: startedAt, updatedAt: startedAt })
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.status, "executing"),
          eq(refreshJobSources.attemptCount, sourceAttemptCount),
          isNull(refreshJobSources.adapterStartedAt),
        ),
      )
      .returning({ sourceId: refreshJobSources.sourceId });
    if (changed.length !== 1) return false;
    await tx
      .update(refreshJobs)
      .set({ revision: job.revision + 1, updatedAt: startedAt })
      .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerTokenHash, tokenHash)));
    return true;
  });
}

/** Checks ownership and source state immediately before adapter invocation. */
export async function canStartRefreshSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
  _now?: string,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash || slot.ownerKind !== "job") {
      return false;
    }
    const [source] = await tx
      .select()
      .from(refreshJobSources)
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.status, "executing"),
          eq(refreshJobSources.attemptCount, sourceAttemptCount),
          isNull(refreshJobSources.adapterStartedAt),
        ),
      );
    return Boolean(source);
  });
}

/** Records successful persistence; cache invalidation remains a separate checkpoint. */
export async function markRefreshSourceSaved(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
  resultCount: number,
  savedAt = nowIso(),
  errorCode?: string,
): Promise<boolean> {
  return updateOwnedSource(jobId, executionToken, sourceId, sourceAttemptCount, "executing", {
    status: "saved",
    resultCount,
    errorCode: errorCode ? sanitizeErrorCode(errorCode) : null,
    savedAt,
    completedAt: savedAt,
    updatedAt: savedAt,
  });
}

/** A Workflow retry can repeat only invalidation while this checkpoint remains saved. */
export async function isRefreshCacheInvalidationPending(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  const [job] = await db.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
  if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
  const [slot] = await db
    .select()
    .from(refreshJobSlot)
    .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
  if (slot?.ownerKind !== "job" || slot.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) {
    return false;
  }
  const [source] = await db
    .select({ status: refreshJobSources.status })
    .from(refreshJobSources)
    .where(and(eq(refreshJobSources.jobId, jobId), eq(refreshJobSources.sourceId, sourceId)));
  return source?.status === "saved";
}

/** Marks cache invalidation complete only after the source data is safely saved. */
export async function markRefreshSourceInvalidated(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
  invalidatedAt = nowIso(),
): Promise<boolean> {
  return updateOwnedSource(jobId, executionToken, sourceId, sourceAttemptCount, "saved", {
    status: "invalidated",
    cacheInvalidatedAt: invalidatedAt,
    updatedAt: invalidatedAt,
  });
}

/** Marks a definitively failed source; ambiguous side-effect outcomes should use unknown. */
export async function markRefreshSourceFailed(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  errorCode: string,
  sourceAttemptCount: number,
): Promise<boolean> {
  const at = nowIso();
  return updateOwnedSource(jobId, executionToken, sourceId, sourceAttemptCount, "executing", {
    status: "failed",
    errorCode,
    completedAt: at,
    updatedAt: at,
  });
}

/** Preserves an ambiguous checkpoint so a duplicate delivery cannot repeat side effects. */
export async function markRefreshSourceUnknown(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  errorCode: string,
  sourceAttemptCount: number,
): Promise<boolean> {
  const at = nowIso();
  return updateOwnedSource(jobId, executionToken, sourceId, sourceAttemptCount, "executing", {
    status: "unknown",
    errorCode,
    updatedAt: at,
  });
}

async function updateOwnedSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  sourceAttemptCount: number,
  expectedStatus: RefreshSourceStatus,
  patch: Partial<typeof refreshJobSources.$inferInsert>,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) return false;
    const changed = await tx
      .update(refreshJobSources)
      .set(patch)
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.attemptCount, sourceAttemptCount),
          eq(refreshJobSources.status, expectedStatus),
        ),
      )
      .returning({ sourceId: refreshJobSources.sourceId });
    if (changed.length !== 1) return false;
    await tx
      .update(refreshJobs)
      .set({ revision: job.revision + 1, updatedAt: nowIso() })
      .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.ownerTokenHash, tokenHash)));
    return true;
  });
}

export async function getRefreshJobSources(jobId: string): Promise<RefreshJobSourceRow[]> {
  return db
    .select()
    .from(refreshJobSources)
    .where(eq(refreshJobSources.jobId, jobId))
    .orderBy(asc(refreshJobSources.ordinal));
}

/** Terminal job state and slot release happen in one transaction, never by TTL. */
export async function finishRefreshJob(
  jobId: string,
  executionToken: string,
  status: Extract<RefreshJobStatus, "completed" | "partial" | "failed">,
  errorCode?: string,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  const now = nowIso();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash) return false;
    // Workflow delivery may repeat after the terminal write committed but its
    // acknowledgement was lost. A same-state call is a safe no-op even if a
    // newer job now owns the global slot.
    if (isTerminal(job.status)) return job.status === status;
    if (job.status === "needs_reconciliation") return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerKind !== "job" || slot.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) {
      return false;
    }
    const sources = await tx
      .select()
      .from(refreshJobSources)
      .where(eq(refreshJobSources.jobId, jobId));
    if (
      sources.some((source) => ["executing", "saved", "unknown"].includes(source.status)) ||
      ((status === "completed" || status === "partial") &&
        sources.some((source) => source.status !== "invalidated" && source.status !== "failed"))
    )
      return false;

    const changed = await tx
      .update(refreshJobs)
      .set({
        status,
        errorCode: errorCode ?? null,
        completedAt: now,
        revision: job.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(refreshJobs.id, jobId),
          eq(refreshJobs.ownerTokenHash, tokenHash),
          eq(refreshJobs.status, job.status),
        ),
      )
      .returning({ id: refreshJobs.id });
    if (changed.length !== 1) return false;

    await tx
      .update(refreshJobSlot)
      .set({
        ownerKind: null,
        ownerId: null,
        ownerTokenHash: null,
        acquiredAt: null,
        leaseKind: null,
        deploymentId: null,
        recoveryAfter: null,
      })
      .where(
        and(
          eq(refreshJobSlot.id, ACTIVE_SLOT_ID),
          eq(refreshJobSlot.ownerId, jobId),
          eq(refreshJobSlot.ownerTokenHash, tokenHash),
        ),
      );
    return true;
  });
}

/** Returns the active shared slot without releasing or expiring it. */
export async function getActiveRefreshSlot() {
  const [slot] = await db
    .select()
    .from(refreshJobSlot)
    .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
  return slot ?? null;
}
