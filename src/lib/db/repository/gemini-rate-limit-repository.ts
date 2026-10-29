import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  WORKFLOW_STEP_MAX_DURATION_SECONDS,
  WORKFLOW_STEP_OWNER_FENCE_AFTER_SECONDS,
} from "@/lib/constants";
import { db } from "../index";

const SLOT_ID = 1;
const ATTEMPT_LIMIT = 15;
const WINDOW_MS = 60_000;

export interface GeminiAttemptOwner {
  ownerId: string;
  ownerToken: string;
}

export type GeminiAttemptClaim =
  | { kind: "claimed"; owner: GeminiAttemptOwner }
  | { kind: "busy"; recoverable: false }
  | { kind: "busy"; recoverable: true; retryAfterMs: number }
  | { kind: "rate-limited"; retryAfterMs: number };

export type GeminiLeaseKind = "workflow-step-300-v1" | "request-60-v1";
export type GeminiLeaseEvidence =
  | { kind: GeminiLeaseKind; deploymentId: string }
  | { kind: "unknown"; deploymentId?: null };

/** Read-only recovery metadata. Never returns the owner token or its hash. */
export interface GeminiRateOwnerStatus {
  ownerId: string;
  acquiredAt: string | null;
  attempt: {
    id: string;
    startedAt: string;
    outcome: "started";
  } | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function dbNowSql(): string {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/**
 * Returns enough information to identify a stranded owner after an ambiguous
 * database response, without exposing authentication material.
 */
export async function getGeminiRateOwnerStatus(): Promise<GeminiRateOwnerStatus | null> {
  const result = await db.$client.execute({
    sql: `SELECT slot.owner_id, slot.acquired_at,
                 attempt.id AS attempt_id, attempt.started_at AS attempt_started_at,
                 attempt.outcome AS attempt_outcome
          FROM gemini_request_slot AS slot
          LEFT JOIN gemini_request_attempts AS attempt
            ON attempt.owner_id = slot.owner_id AND attempt.outcome = 'started'
          WHERE slot.id = ? AND slot.owner_id IS NOT NULL
          ORDER BY attempt.started_at DESC LIMIT 1`,
    args: [SLOT_ID],
  });
  const row = result.rows[0] as unknown as
    | {
        owner_id: string;
        acquired_at: string | null;
        attempt_id: string | null;
        attempt_started_at: string | null;
        attempt_outcome: "started" | null;
      }
    | undefined;
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    acquiredAt: row.acquired_at,
    attempt:
      row.attempt_id && row.attempt_started_at
        ? { id: row.attempt_id, startedAt: row.attempt_started_at, outcome: "started" }
        : null,
  };
}

/**
 * Claims the singleton send slot and admits an HTTP attempt only if fewer than
 * 15 attempts completed during the preceding 60 seconds. All time comparisons
 * use the shared SQLite/Turso clock. A rate-limited claim releases the slot so
 * the caller can sleep and claim again later.
 */
export async function claimGeminiAttempt(
  lease: GeminiLeaseEvidence = { kind: "unknown" },
): Promise<GeminiAttemptClaim> {
  const owner: GeminiAttemptOwner = {
    ownerId: randomUUID(),
    ownerToken: randomBytes(32).toString("base64url"),
  };
  const tokenHash = hashToken(owner.ownerToken);

  const leaseDurationSeconds =
    lease.kind === "workflow-step-300-v1"
      ? WORKFLOW_STEP_OWNER_FENCE_AFTER_SECONDS
      : lease.kind === "request-60-v1"
        ? 120
        : WORKFLOW_STEP_MAX_DURATION_SECONDS;
  const validLease = lease.kind !== "unknown" && lease.deploymentId.trim().length > 0;
  const recoveryAfter =
    lease.kind === "unknown"
      ? "NULL"
      : `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${leaseDurationSeconds} seconds')`;

  const result = await db.$client.batch(
    [
      {
        sql: "INSERT INTO gemini_request_slot (id) VALUES (?) ON CONFLICT(id) DO NOTHING",
        args: [SLOT_ID],
      },
      {
        // Only leases with an explicit, build-verified duration marker expire.
        // Preserve an uncertain send in the rolling-window ledger before the
        // old owner is removed, so a replacement claim still observes 15/60.
        sql: `UPDATE gemini_request_attempts
              SET outcome = 'ambiguous', completed_at = ${dbNowSql()}
              WHERE outcome = 'started'
                AND owner_id = (SELECT owner_id FROM gemini_request_slot
                  WHERE id = ? AND recovery_after IS NOT NULL
                    AND julianday(recovery_after) <= julianday('now'))`,
        args: [SLOT_ID],
      },
      {
        sql: `UPDATE gemini_request_slot
              SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
                  lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
              WHERE id = ? AND owner_id IS NOT NULL AND recovery_after IS NOT NULL
                AND lease_kind IN ('workflow-step-300-v1', 'request-60-v1')
                AND deployment_id IS NOT NULL AND length(deployment_id) > 0
                AND julianday(recovery_after) <= julianday('now')`,
        args: [SLOT_ID],
      },
      {
        sql: `UPDATE gemini_request_slot
              SET owner_id = ?, owner_token_hash = ?, acquired_at = ${dbNowSql()},
                  lease_kind = ?, deployment_id = ?, recovery_after = ${recoveryAfter}
              WHERE id = ? AND owner_id IS NULL`,
        args: [
          owner.ownerId,
          tokenHash,
          validLease ? lease.kind : "unknown",
          validLease ? lease.deploymentId : null,
          SLOT_ID,
        ],
      },
      {
        sql: `DELETE FROM gemini_request_attempts
              WHERE completed_at IS NOT NULL
                AND julianday(completed_at) <= julianday('now', '-60 seconds')`,
        args: [],
      },
      {
        sql: `SELECT owner_id, owner_token_hash, lease_kind, deployment_id,
                     recovery_after, julianday(recovery_after) AS recovery_julian,
                     julianday('now') AS now_julian,
                     (SELECT COUNT(*) FROM gemini_request_attempts
                       WHERE completed_at IS NOT NULL
                         AND julianday(completed_at) > julianday('now', '-60 seconds')) AS recent_count,
                     (SELECT MIN(julianday(completed_at)) FROM gemini_request_attempts
                       WHERE completed_at IS NOT NULL
                         AND julianday(completed_at) > julianday('now', '-60 seconds')) AS oldest_julian
              FROM gemini_request_slot WHERE id = ?`,
        args: [SLOT_ID],
      },
    ],
    "write",
  );

  const row = result[5]?.rows[0] as unknown as
    | {
        owner_id: string | null;
        owner_token_hash: string | null;
        lease_kind: string | null;
        deployment_id: string | null;
        recovery_after: string | null;
        recovery_julian: number | null;
        now_julian: number;
        recent_count: number;
        oldest_julian: number | null;
      }
    | undefined;
  if (row?.owner_id !== owner.ownerId || row.owner_token_hash !== tokenHash) {
    const retryAfterMs =
      (row?.lease_kind === "workflow-step-300-v1" || row?.lease_kind === "request-60-v1") &&
      row.deployment_id &&
      row.recovery_julian !== null
        ? (Number(row.recovery_julian) - Number(row.now_julian)) * 86_400_000
        : 0;
    if (retryAfterMs > 0) {
      return { kind: "busy", recoverable: true, retryAfterMs: Math.ceil(retryAfterMs) };
    }
    return { kind: "busy", recoverable: false };
  }

  const recentCount = Number(row.recent_count);
  if (recentCount < ATTEMPT_LIMIT) return { kind: "claimed", owner };

  const release = await db.$client.execute({
    sql: `UPDATE gemini_request_slot
          SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
              lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
          WHERE id = ? AND owner_id = ? AND owner_token_hash = ?`,
    args: [SLOT_ID, owner.ownerId, tokenHash],
  });
  if (Number(release.rowsAffected) !== 1)
    throw new Error("failed_to_release_rate_limited_gemini_slot");

  const remainingMs =
    row.oldest_julian === null
      ? WINDOW_MS
      : (Number(row.oldest_julian) + 60 / 86_400 - Number(row.now_julian) + 2 / 86_400_000) *
        86_400_000;
  return { kind: "rate-limited", retryAfterMs: Math.max(1, Math.ceil(remainingMs)) };
}

/** Records the attempt immediately before the HTTP request is started. */
export async function beginGeminiAttempt(
  owner: GeminiAttemptOwner,
  attemptId = randomUUID(),
): Promise<string> {
  const result = await db.$client.execute({
    sql: `INSERT INTO gemini_request_attempts (id, owner_id, started_at, outcome)
          SELECT ?, ?, ${dbNowSql()}, 'started'
          WHERE EXISTS (
            SELECT 1 FROM gemini_request_slot
            WHERE id = ? AND owner_id = ? AND owner_token_hash = ?
          )`,
    args: [attemptId, owner.ownerId, SLOT_ID, owner.ownerId, hashToken(owner.ownerToken)],
  });
  if (Number(result.rowsAffected) !== 1) throw new Error("gemini_attempt_owner_not_held");
  return attemptId;
}

/**
 * Persists success or failure and releases the send slot atomically. If this
 * fails, the caller must leave the owner in place and stop further sends.
 */
export async function completeGeminiAttempt(
  owner: GeminiAttemptOwner,
  attemptId: string,
  outcome: "succeeded" | "failed",
): Promise<boolean> {
  const tokenHash = hashToken(owner.ownerToken);
  const statements = [
    {
      sql: `UPDATE gemini_request_attempts SET outcome = ?, completed_at = ${dbNowSql()}
            WHERE id = ? AND owner_id = ? AND outcome = 'started'
              AND EXISTS (SELECT 1 FROM gemini_request_slot
                WHERE id = ? AND owner_id = ? AND owner_token_hash = ?)`,
      args: [outcome, attemptId, owner.ownerId, SLOT_ID, owner.ownerId, tokenHash],
    },
    {
      sql: `UPDATE gemini_request_slot
            SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
                lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
            WHERE id = ? AND owner_id = ? AND owner_token_hash = ?
              AND EXISTS (SELECT 1 FROM gemini_request_attempts
                WHERE id = ? AND owner_id = ? AND outcome = ? AND completed_at IS NOT NULL)`,
      args: [SLOT_ID, owner.ownerId, tokenHash, attemptId, owner.ownerId, outcome],
    },
  ];
  const result = await db.$client.batch(statements, "write");
  return Number(result[0]?.rowsAffected) === 1 && Number(result[1]?.rowsAffected) === 1;
}

/**
 * Emergency release for a process that has been externally fenced. A started
 * attempt is conservatively counted as an ambiguous completed attempt before
 * the owner is removed. Never call this from a timeout or TTL reaper.
 */
export async function releaseFencedGeminiOwner(
  ownerId: string,
  attemptId?: string,
): Promise<boolean> {
  // This is deliberately the only tokenless API. It is for an operator or
  // recovery workflow that has already proved the old process cannot resume.
  const statements = attemptId
    ? [
        {
          sql: `UPDATE gemini_request_attempts SET outcome = 'ambiguous', completed_at = ${dbNowSql()}
                WHERE id = ? AND owner_id = ? AND outcome = 'started'
                  AND EXISTS (SELECT 1 FROM gemini_request_slot
                    WHERE id = ? AND owner_id = ?)`,
          args: [attemptId, ownerId, SLOT_ID, ownerId],
        },
        {
          sql: `UPDATE gemini_request_slot
                SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
                    lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
                WHERE id = ? AND owner_id = ?
                  AND EXISTS (SELECT 1 FROM gemini_request_attempts
                    WHERE id = ? AND owner_id = ? AND outcome = 'ambiguous' AND completed_at IS NOT NULL)`,
          args: [SLOT_ID, ownerId, attemptId, ownerId],
        },
      ]
    : [
        {
          sql: `UPDATE gemini_request_slot
                SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
                    lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
                WHERE id = ? AND owner_id = ?
                  AND NOT EXISTS (SELECT 1 FROM gemini_request_attempts
                    WHERE owner_id = ? AND outcome = 'started')`,
          args: [SLOT_ID, ownerId, ownerId],
        },
      ];
  const result = await db.$client.batch(statements, "write");
  return Number(result.at(-1)?.rowsAffected) === 1;
}

export async function getGeminiRateWindow(): Promise<{
  recentAttempts: number;
  retryAfterMs: number;
}> {
  const result = await db.$client.execute({
    sql: `SELECT COUNT(*) AS recent_count,
                 julianday('now') AS now_julian,
                 MIN(julianday(completed_at)) AS oldest_julian
          FROM gemini_request_attempts
          WHERE completed_at IS NOT NULL
            AND julianday(completed_at) > julianday('now', '-60 seconds')`,
    args: [],
  });
  const row = result.rows[0] as unknown as
    | { recent_count: number; oldest_julian: number | null; now_julian: number }
    | undefined;
  const recentAttempts = Number(row?.recent_count ?? 0);
  if (
    recentAttempts < ATTEMPT_LIMIT ||
    row?.oldest_julian === null ||
    row?.oldest_julian === undefined
  ) {
    return { recentAttempts, retryAfterMs: 0 };
  }
  const retryAfterMs =
    (Number(row.oldest_julian) + 60 / 86_400 - Number(row.now_julian) + 2 / 86_400_000) *
    86_400_000;
  return { recentAttempts, retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)) };
}

export const GEMINI_ATTEMPT_LIMIT = ATTEMPT_LIMIT;
export const GEMINI_ATTEMPT_WINDOW_MS = WINDOW_MS;
