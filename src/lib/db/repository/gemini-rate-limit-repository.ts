import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  WORKFLOW_STEP_MAX_DURATION_SECONDS,
  WORKFLOW_STEP_OWNER_FENCE_AFTER_SECONDS,
} from "@/lib/constants";
import { db } from "../index";

const SLOT_ID = 1;
const ATTEMPT_LIMIT = 15;
const WINDOW_MS = 60_000;
const START_INTERVAL_MS = 5_000;

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
    sql: `SELECT COALESCE(attempt.owner_id, slot.owner_id) AS owner_id,
                 COALESCE(attempt.started_at, slot.acquired_at) AS acquired_at,
                 attempt.id AS attempt_id, attempt.started_at AS attempt_started_at,
                 attempt.outcome AS attempt_outcome
          FROM gemini_request_slot AS slot
          LEFT JOIN gemini_request_attempts AS attempt ON attempt.outcome = 'started'
          WHERE slot.id = ? AND (slot.owner_id IS NOT NULL OR attempt.id IS NOT NULL)
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
 * The singleton slot serializes admission only. Once an HTTP attempt starts,
 * its own lease metadata stays on the attempt row so other requests may be
 * admitted on the global five-second cadence without losing fencing.
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
        // Backfill an attempt created by the previous version while its lease
        // still lives on the singleton slot. This keeps in-flight deployments
        // recoverable across the additive migration.
        sql: `UPDATE gemini_request_attempts
              SET owner_token_hash = (SELECT owner_token_hash FROM gemini_request_slot
                    WHERE id = ? AND owner_id = gemini_request_attempts.owner_id),
                  lease_kind = (SELECT lease_kind FROM gemini_request_slot
                    WHERE id = ? AND owner_id = gemini_request_attempts.owner_id),
                  deployment_id = (SELECT deployment_id FROM gemini_request_slot
                    WHERE id = ? AND owner_id = gemini_request_attempts.owner_id),
                  recovery_after = (SELECT recovery_after FROM gemini_request_slot
                    WHERE id = ? AND owner_id = gemini_request_attempts.owner_id)
              WHERE outcome = 'started' AND owner_token_hash IS NULL
                AND EXISTS (SELECT 1 FROM gemini_request_slot
                  WHERE id = ? AND owner_id = gemini_request_attempts.owner_id)`,
        args: [SLOT_ID, SLOT_ID, SLOT_ID, SLOT_ID, SLOT_ID],
      },
      {
        // Explicitly bounded attempt leases can be recovered independently.
        sql: `UPDATE gemini_request_attempts
              SET outcome = 'ambiguous', completed_at = ${dbNowSql()}
              WHERE outcome = 'started'
                AND recovery_after IS NOT NULL
                AND lease_kind IN ('workflow-step-300-v1', 'request-60-v1')
                AND deployment_id IS NOT NULL AND length(deployment_id) > 0
                AND julianday(recovery_after) <= julianday('now')`,
        args: [],
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
                       WHERE julianday(started_at) > julianday('now', '-60 seconds')) AS recent_count,
                     (SELECT MIN(julianday(started_at)) FROM gemini_request_attempts
                       WHERE julianday(started_at) > julianday('now', '-60 seconds')) AS oldest_julian,
                     (SELECT MAX(julianday(started_at)) FROM gemini_request_attempts) AS latest_julian
                     , (SELECT COUNT(*) FROM gemini_request_attempts
                       WHERE outcome = 'started'
                         AND (recovery_after IS NULL OR lease_kind NOT IN ('workflow-step-300-v1', 'request-60-v1')
                           OR deployment_id IS NULL OR length(deployment_id) = 0)) AS unbounded_inflight
              FROM gemini_request_slot WHERE id = ?`,
        args: [SLOT_ID],
      },
    ],
    "write",
  );

  const row = result[6]?.rows[0] as unknown as
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
        latest_julian: number | null;
        unbounded_inflight: number;
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
  if (Number(row.unbounded_inflight) > 0) {
    const release = await db.$client.execute({
      sql: `UPDATE gemini_request_slot
            SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
                lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
            WHERE id = ? AND owner_id = ? AND owner_token_hash = ?`,
      args: [SLOT_ID, owner.ownerId, tokenHash],
    });
    if (Number(release.rowsAffected) !== 1)
      throw new Error("failed_to_release_unbounded_gemini_slot");
    return { kind: "busy", recoverable: false };
  }
  const cadenceWaitMs =
    row.latest_julian === null
      ? 0
      : (Number(row.latest_julian) + START_INTERVAL_MS / 86_400_000 - Number(row.now_julian)) *
        86_400_000;
  if (recentCount < ATTEMPT_LIMIT && cadenceWaitMs <= 0) return { kind: "claimed", owner };

  const release = await db.$client.execute({
    sql: `UPDATE gemini_request_slot
          SET owner_id = NULL, owner_token_hash = NULL, acquired_at = NULL,
              lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
          WHERE id = ? AND owner_id = ? AND owner_token_hash = ?`,
    args: [SLOT_ID, owner.ownerId, tokenHash],
  });
  if (Number(release.rowsAffected) !== 1)
    throw new Error("failed_to_release_rate_limited_gemini_slot");

  const windowWaitMs =
    row.oldest_julian === null
      ? WINDOW_MS
      : (Number(row.oldest_julian) + 60 / 86_400 - Number(row.now_julian) + 2 / 86_400_000) *
        86_400_000;
  return {
    kind: "rate-limited",
    retryAfterMs: Math.max(
      1,
      Math.ceil(recentCount >= ATTEMPT_LIMIT ? windowWaitMs : cadenceWaitMs),
    ),
  };
}

/** Records the attempt immediately before the HTTP request is started. */
export async function beginGeminiAttempt(
  owner: GeminiAttemptOwner,
  attemptId = randomUUID(),
): Promise<string> {
  const lease = await db.$client.batch(
    [
      {
        sql: `INSERT INTO gemini_request_attempts
              (id, owner_id, started_at, outcome, owner_token_hash, lease_kind, deployment_id, recovery_after)
            SELECT ?, ?, ${dbNowSql()}, 'started', owner_token_hash, lease_kind, deployment_id, recovery_after
            FROM gemini_request_slot
            WHERE id = ? AND owner_id = ? AND owner_token_hash = ?`,
        args: [attemptId, owner.ownerId, SLOT_ID, owner.ownerId, hashToken(owner.ownerToken)],
      },
      {
        sql: `UPDATE gemini_request_slot SET owner_id = NULL, owner_token_hash = NULL,
              acquired_at = NULL, lease_kind = NULL, deployment_id = NULL, recovery_after = NULL
            WHERE id = ? AND owner_id = ? AND owner_token_hash = ?
              AND EXISTS (SELECT 1 FROM gemini_request_attempts WHERE id = ? AND owner_id = ?)`,
        args: [SLOT_ID, owner.ownerId, hashToken(owner.ownerToken), attemptId, owner.ownerId],
      },
    ],
    "write",
  );
  if (Number(lease[0]?.rowsAffected) !== 1 || Number(lease[1]?.rowsAffected) !== 1)
    throw new Error("gemini_attempt_owner_not_held");
  return attemptId;
}

/**
 * Persists success or failure for the attempt's independently fenced lease.
 */
export async function completeGeminiAttempt(
  owner: GeminiAttemptOwner,
  attemptId: string,
  outcome: "succeeded" | "failed",
): Promise<boolean> {
  const result = await db.$client.execute({
    sql: `UPDATE gemini_request_attempts SET outcome = ?, completed_at = ${dbNowSql()}
          WHERE id = ? AND owner_id = ? AND owner_token_hash = ? AND outcome = 'started'`,
    args: [outcome, attemptId, owner.ownerId, hashToken(owner.ownerToken)],
  });
  return Number(result.rowsAffected) === 1;
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
                  AND owner_token_hash IS NOT NULL`,
          args: [attemptId, ownerId],
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
  return Number(result[0]?.rowsAffected) === 1;
}

export async function getGeminiRateWindow(): Promise<{
  recentAttempts: number;
  retryAfterMs: number;
}> {
  const result = await db.$client.execute({
    sql: `SELECT COUNT(*) AS recent_count,
                 julianday('now') AS now_julian,
                 MIN(julianday(started_at)) AS oldest_julian
          FROM gemini_request_attempts
          WHERE julianday(started_at) > julianday('now', '-60 seconds')`,
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
