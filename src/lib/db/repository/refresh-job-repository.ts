import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
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
const MIN_SOURCE_START_GAP_MS = 70_000;

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
            SET owner_kind = 'job', owner_id = ?, owner_token_hash = ?, acquired_at = ?
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

/** Claims the same singleton slot for an existing single-source caller. */
export async function claimSingleRefresh(): Promise<SingleRefreshClaim> {
  const ownerId = `single:${randomUUID()}`;
  const ownerToken = makeToken();
  const ownerTokenHash = hashToken(ownerToken);
  const now = nowIso();

  const result = await db.$client.batch(
    [
      {
        sql: "INSERT INTO refresh_job_slot (id) VALUES (?) ON CONFLICT(id) DO NOTHING",
        args: [ACTIVE_SLOT_ID],
      },
      {
        sql: `UPDATE refresh_job_slot
              SET owner_kind = 'single', owner_id = ?, owner_token_hash = ?, acquired_at = ?
              WHERE id = ? AND owner_id IS NULL`,
        args: [ownerId, ownerTokenHash, now, ACTIVE_SLOT_ID],
      },
      {
        sql: "SELECT owner_kind, owner_id, owner_token_hash FROM refresh_job_slot WHERE id = ?",
        args: [ACTIVE_SLOT_ID],
      },
    ],
    "write",
  );
  const rawRow: unknown = result[2]?.rows[0];
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
    .set({ ownerKind: null, ownerId: null, ownerTokenHash: null, acquiredAt: null })
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
      .set({ status: "executing", updatedAt: now })
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

/** Persists the true adapter-call boundary timestamp before calling an adapter. */
export async function recordAdapterStart(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
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
    if (job.nextEligibleAt && Date.parse(startedAt) < Date.parse(job.nextEligibleAt)) return false;
    const changed = await tx
      .update(refreshJobSources)
      .set({ adapterStartedAt: startedAt, updatedAt: startedAt })
      .where(
        and(
          eq(refreshJobSources.jobId, jobId),
          eq(refreshJobSources.sourceId, sourceId),
          eq(refreshJobSources.status, "executing"),
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

/** Checks ownership and the durable start gate immediately before adapter invocation. */
export async function canStartRefreshSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  now = nowIso(),
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
    if (job.nextEligibleAt && Date.parse(now) < Date.parse(job.nextEligibleAt)) return false;
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
  resultCount: number,
  savedAt = nowIso(),
  errorCode?: string,
): Promise<boolean> {
  return updateOwnedSource(jobId, executionToken, sourceId, "executing", {
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
  invalidatedAt = nowIso(),
): Promise<boolean> {
  return updateOwnedSource(jobId, executionToken, sourceId, "saved", {
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
): Promise<boolean> {
  const at = nowIso();
  return updateOwnedSource(jobId, executionToken, sourceId, "executing", {
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
): Promise<boolean> {
  const at = nowIso();
  return updateOwnedSource(jobId, executionToken, sourceId, "executing", {
    status: "unknown",
    errorCode,
    updatedAt: at,
  });
}

async function updateOwnedSource(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
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

/** Sets a future start gate based on the last actual adapter invocation. */
export async function setNextEligibleAt(
  jobId: string,
  executionToken: string,
  nextEligibleAt: string,
): Promise<boolean> {
  const tokenHash = hashToken(executionToken);
  const now = nowIso();
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(refreshJobs).where(eq(refreshJobs.id, jobId));
    if (!job || job.ownerTokenHash !== tokenHash || job.status !== "running") return false;
    const [slot] = await tx
      .select()
      .from(refreshJobSlot)
      .where(eq(refreshJobSlot.id, ACTIVE_SLOT_ID));
    if (slot?.ownerId !== jobId || slot.ownerTokenHash !== tokenHash) return false;
    const sources = await tx
      .select()
      .from(refreshJobSources)
      .where(eq(refreshJobSources.jobId, jobId))
      .orderBy(asc(refreshJobSources.ordinal));
    const latestStart = sources.reduce<string | null>(
      (latest, source) =>
        source.adapterStartedAt && (!latest || source.adapterStartedAt > latest)
          ? source.adapterStartedAt
          : latest,
      null,
    );
    if (
      !latestStart ||
      Date.parse(nextEligibleAt) < Date.parse(latestStart) + MIN_SOURCE_START_GAP_MS
    ) {
      return false;
    }
    const updated = await tx
      .update(refreshJobs)
      .set({ nextEligibleAt, revision: job.revision + 1, updatedAt: now })
      .where(
        and(
          eq(refreshJobs.id, jobId),
          eq(refreshJobs.ownerTokenHash, tokenHash),
          eq(refreshJobs.revision, job.revision),
        ),
      )
      .returning({ id: refreshJobs.id });
    return updated.length === 1;
  });
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
      .set({ ownerKind: null, ownerId: null, ownerTokenHash: null, acquiredAt: null })
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
