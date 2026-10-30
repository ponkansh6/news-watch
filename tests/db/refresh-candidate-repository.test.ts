import { afterEach, describe, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  claimRefreshSource,
  markRefreshSourceUnknown,
  recordAdapterStart,
  recoverRefreshSource,
  startAggregateJob,
} from "@/lib/db/repository/refresh-job-repository";
import {
  claimCandidateBatch,
  deferCandidateBatchForRateLimit,
  freezeNextCandidateBatch,
  getRefreshArticleProgress,
  getBatchCandidates,
  getCandidateBatch,
  listRefreshJobCandidates,
  markCandidateBatchFailed,
  markCandidateBatchSaved,
  markCandidateBatchUnknown,
  retryFailedCandidateBatch,
  recoverUnknownCandidateBatch,
  stageRefreshCandidates,
  storeCandidateBatchResult,
  summarizePendingCandidateSignatures,
} from "@/lib/db/repository/refresh-candidate-repository";
import {
  refreshJobBatches,
  refreshJobCandidates,
  refreshJobSlot,
  refreshJobs,
  refreshJobSources,
} from "@/lib/db/schema";
import { SOURCE_IDS } from "@/lib/news/registry";

const jobs: string[] = [];
const sourceAttempts = new Map<string, number>();

async function newJob() {
  const started = await startAggregateJob();
  if (started.kind !== "created" || !started.job || !started.executionToken) {
    throw new Error("could not create aggregate job for test");
  }
  jobs.push(started.job.id);
  await db.update(refreshJobs).set({ status: "running" }).where(eq(refreshJobs.id, started.job.id));
  return { id: started.job.id, token: started.executionToken };
}

function candidate(index: number, sourceId = SOURCE_IDS[0]!) {
  return {
    sourceId,
    contentHash: `hash-${index}`,
    scoringSignature: "signature-v1",
    payload: {
      title: `title-${index}`,
      description: `description-${index}`,
      url: `https://example.com/${index}`,
      publishedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

async function stageCandidates(
  job: { id: string; token: string },
  sourceId: (typeof SOURCE_IDS)[number],
  candidates: Parameters<typeof stageRefreshCandidates>[3],
  resultCount?: number,
) {
  const key = `${job.id}:${sourceId}`;
  let attemptCount = sourceAttempts.get(key);
  if (attemptCount === undefined) {
    const claim = await claimRefreshSource(job.id, job.token, sourceId);
    if (!claim) throw new Error("source_claim_failed");
    attemptCount = claim.attemptCount;
    sourceAttempts.set(key, attemptCount);
    if (!(await recordAdapterStart(job.id, job.token, sourceId, attemptCount))) {
      throw new Error("source_start_failed");
    }
  }
  return stageRefreshCandidates(job.id, job.token, sourceId, candidates, {
    sourceAttemptCount: attemptCount,
    resultCount: resultCount ?? candidates.length,
  });
}

afterEach(async () => {
  if (jobs.length) await db.delete(refreshJobs).where(inArray(refreshJobs.id, jobs));
  jobs.length = 0;
  sourceAttempts.clear();
  await db.delete(refreshJobSlot).where(eq(refreshJobSlot.id, 1));
});

describe("refresh candidate repository", () => {
  test("commits staged candidates and the source saved checkpoint atomically", async () => {
    const job = await newJob();
    const sourceId = SOURCE_IDS[0]!;
    await stageCandidates(job, sourceId, [candidate(1, sourceId)], 1);

    const [source] = await db
      .select()
      .from(refreshJobSources)
      .where(eq(refreshJobSources.jobId, job.id));
    expect(source).toMatchObject({ status: "saved", resultCount: 1 });
    expect(await listRefreshJobCandidates(job.id, job.token)).toHaveLength(1);
  });

  test("rejects a late source result after an automatic recovery fenced its attempt", async () => {
    const job = await newJob();
    const sourceId = SOURCE_IDS[0]!;
    const stale = await claimRefreshSource(job.id, job.token, sourceId);
    expect(stale).not.toBeNull();
    expect(await recordAdapterStart(job.id, job.token, sourceId, stale!.attemptCount)).toBe(true);
    expect(
      await markRefreshSourceUnknown(
        job.id,
        job.token,
        sourceId,
        "fetch_unknown",
        stale!.attemptCount,
      ),
    ).toBe(true);
    expect(
      await recoverRefreshSource(job.id, job.token, sourceId, stale!.attemptCount),
    ).toMatchObject({ kind: "retry" });

    const current = await claimRefreshSource(job.id, job.token, sourceId);
    expect(current?.attemptCount).toBe(stale!.attemptCount + 1);
    expect(await recordAdapterStart(job.id, job.token, sourceId, current!.attemptCount)).toBe(true);
    await expect(
      stageRefreshCandidates(job.id, job.token, sourceId, [candidate(9, sourceId)], {
        resultCount: 1,
        sourceAttemptCount: stale!.attemptCount,
      }),
    ).rejects.toThrow("refresh_source_attempt_fenced");
    expect(await listRefreshJobCandidates(job.id, job.token)).toEqual([]);
  });

  test("deduplicates canonical URLs and records every source with stable representative", async () => {
    const job = await newJob();
    const firstSource = SOURCE_IDS[0]!;
    const secondSource = SOURCE_IDS[1]!;
    await stageCandidates(job, firstSource, [candidate(1, firstSource)]);
    const duplicate = candidate(2, secondSource);
    duplicate.payload.url = "https://EXAMPLE.com:443/1";
    const result = await stageCandidates(job, secondSource, [duplicate]);

    const rows = await listRefreshJobCandidates(job.id, job.token);
    expect(result).toEqual({ inserted: 0, merged: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.representativeSourceId).toBe(firstSource);
    expect(JSON.parse(rows[0]!.sourceIdsJson)).toEqual([firstSource, secondSource]);
  });

  test("counts unique candidates by persisted state and waits for every source", async () => {
    const job = await newJob();
    const firstSource = SOURCE_IDS[0]!;
    const secondSource = SOURCE_IDS[1]!;
    await stageCandidates(job, firstSource, [candidate(1, firstSource), candidate(2, firstSource)]);
    const duplicate = candidate(3, secondSource);
    duplicate.payload.url = "https://EXAMPLE.com:443/1";
    await stageCandidates(job, secondSource, [duplicate]);

    expect(await getRefreshArticleProgress(job.id)).toEqual({
      candidateTotal: 2,
      savedCount: 0,
      failedCount: 0,
      collectionComplete: false,
    });

    const [firstCandidate, secondCandidate] = await listRefreshJobCandidates(job.id, job.token);
    await db
      .update(refreshJobCandidates)
      .set({ status: "saved" })
      .where(eq(refreshJobCandidates.id, firstCandidate!.id));
    await db
      .update(refreshJobCandidates)
      .set({ status: "failed" })
      .where(eq(refreshJobCandidates.id, secondCandidate!.id));
    await db
      .update(refreshJobSources)
      .set({ status: "saved" })
      .where(eq(refreshJobSources.jobId, job.id));

    expect(await getRefreshArticleProgress(job.id)).toEqual({
      candidateTotal: 2,
      savedCount: 1,
      failedCount: 1,
      collectionComplete: true,
    });
  });

  test("distinguishes a missing job from a zero-source job and terminal empty jobs", async () => {
    const job = await newJob();
    await db.delete(refreshJobSources).where(eq(refreshJobSources.jobId, job.id));

    expect(await getRefreshArticleProgress(job.id)).toEqual({
      candidateTotal: 0,
      savedCount: 0,
      failedCount: 0,
      collectionComplete: false,
    });
    expect(await getRefreshArticleProgress("missing-job")).toBeNull();

    await db.update(refreshJobs).set({ status: "completed" }).where(eq(refreshJobs.id, job.id));
    expect(await getRefreshArticleProgress(job.id)).toEqual({
      candidateTotal: 0,
      savedCount: 0,
      failedCount: 0,
      collectionComplete: true,
    });
  });

  test.each([0, 1, 49, 50, 51])(
    "freezes an immutable full/tail batch for %i candidates",
    async (count) => {
      const job = await newJob();
      const firstSource = SOURCE_IDS[0]!;
      const firstCount = Math.min(count, 50);
      await stageCandidates(
        job,
        firstSource,
        Array.from({ length: firstCount }, (_, i) => candidate(i, firstSource)),
      );
      if (count > firstCount) {
        const secondSource = SOURCE_IDS[1]!;
        await stageCandidates(
          job,
          secondSource,
          Array.from({ length: count - firstCount }, (_, i) =>
            candidate(firstCount + i, secondSource),
          ),
        );
      }
      const early = await freezeNextCandidateBatch(job.id, job.token, "signature-v1");
      if (count < 50) expect(early).toBeNull();
      else expect(JSON.parse(early!.candidateIdsJson)).toHaveLength(50);

      const tail = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
      const expectedTail = count === 51 ? 1 : count < 50 ? count : 0;
      expect(tail ? JSON.parse(tail.candidateIdsJson) : []).toHaveLength(expectedTail);
      const batches = await db
        .select()
        .from(refreshJobBatches)
        .where(eq(refreshJobBatches.jobId, job.id));
      expect(batches.map((batch) => JSON.parse(batch.candidateIdsJson).length)).toEqual(
        count === 51 ? [50, 1] : count === 50 ? [50] : count ? [count] : [],
      );
    },
  );

  test.each([250, 1000])(
    "aggregates and freezes %i candidates in batches of at most 50",
    async (count) => {
      const job = await newJob();
      const now = new Date().toISOString();
      const rows = Array.from({ length: count }, (_, ordinal) => ({
        id: `bulk-${job.id}-${ordinal}`,
        jobId: job.id,
        normalizedUrl: `https://example.com/bulk-${ordinal}`,
        payloadJson: JSON.stringify({ title: `title-${ordinal}` }),
        contentHash: `bulk-hash-${ordinal}`,
        scoringSignature: "signature-v1",
        representativeSourceId: SOURCE_IDS[0]!,
        sourceIdsJson: JSON.stringify([SOURCE_IDS[0]!]),
        ordinal,
        status: "pending" as const,
        batchId: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      }));
      for (let offset = 0; offset < rows.length; offset += 50) {
        await db.insert(refreshJobCandidates).values(rows.slice(offset, offset + 50));
      }

      expect(await summarizePendingCandidateSignatures(job.id, job.token)).toEqual([
        { scoringSignature: "signature-v1", candidateCount: count, firstOrdinal: 0 },
      ]);
      const frozenIds = new Set<string>();
      const frozenSizes: number[] = [];
      while (true) {
        const batch = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
        if (!batch) break;
        const ids = JSON.parse(batch.candidateIdsJson) as string[];
        frozenSizes.push(ids.length);
        ids.forEach((id) => frozenIds.add(id));
      }

      expect(frozenIds.size).toBe(count);
      expect(frozenSizes).toEqual(Array.from({ length: count / 50 }, () => 50));
    },
  );

  test("rejects a stale execution token when freezing candidates", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1)]);

    await expect(
      freezeNextCandidateBatch(job.id, "stale-token", "signature-v1", true),
    ).rejects.toThrow("refresh_job_not_owned");
    expect(
      await db.select().from(refreshJobBatches).where(eq(refreshJobBatches.jobId, job.id)),
    ).toEqual([]);
    expect(await listRefreshJobCandidates(job.id, job.token, ["pending"])).toHaveLength(1);
  });

  test("summarizes pending signatures in first-candidate order without changing candidate order", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1), candidate(2)]);
    await stageCandidates(job, SOURCE_IDS[1]!, [
      { ...candidate(3, SOURCE_IDS[1]!), scoringSignature: "signature-v2" },
    ]);

    expect(await summarizePendingCandidateSignatures(job.id, job.token)).toEqual([
      { scoringSignature: "signature-v1", candidateCount: 2, firstOrdinal: 0 },
      { scoringSignature: "signature-v2", candidateCount: 1, firstOrdinal: 2 },
    ]);
    await expect(summarizePendingCandidateSignatures(job.id, "wrong-token")).rejects.toThrow(
      "not_owned",
    );
  });

  test("rolls back batch insertion when a conditional membership update returns an incomplete set", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1), candidate(2)]);
    const candidates = await listRefreshJobCandidates(job.id, job.token, ["pending"]);
    const ignoredId = candidates[1]!.id;
    await db.run(
      sql.raw(
        `CREATE TRIGGER ignore_candidate_batch_update BEFORE UPDATE OF status ON refresh_job_candidates WHEN OLD.id = '${ignoredId}' BEGIN SELECT RAISE(IGNORE); END`,
      ),
    );

    try {
      await expect(
        freezeNextCandidateBatch(job.id, job.token, "signature-v1", true),
      ).rejects.toThrow("candidate_batch_membership_update_mismatch");
    } finally {
      await db.run(sql.raw("DROP TRIGGER IF EXISTS ignore_candidate_batch_update"));
    }

    expect(
      await db.select().from(refreshJobBatches).where(eq(refreshJobBatches.jobId, job.id)),
    ).toEqual([]);
    expect(await listRefreshJobCandidates(job.id, job.token, ["pending"])).toHaveLength(2);
  });

  test("claims once and persists validated results before idempotent completion", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1), candidate(2)]);
    const batch = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
    expect(batch).not.toBeNull();
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toBeNull();
    const candidates = await getBatchCandidates(job.id, job.token, batch!.id);
    const result = Object.fromEntries(candidates.map((row) => [row.id, { score: 1 }]));
    await expect(
      storeCandidateBatchResult(job.id, job.token, batch!.id, { unknown: {} }, 1),
    ).rejects.toThrow("ids_mismatch");
    expect(await storeCandidateBatchResult(job.id, job.token, batch!.id, result, 1)).toBe(true);
    expect((await getCandidateBatch(job.id, job.token, batch!.id))?.status).toBe("result_ready");
    expect(await markCandidateBatchSaved(job.id, job.token, batch!.id)).toBe(true);
    expect(await markCandidateBatchSaved(job.id, job.token, batch!.id)).toBe(false);
    expect(
      (await listRefreshJobCandidates(job.id, job.token)).every((row) => row.status === "saved"),
    ).toBe(true);
  });

  test("rejects wrong execution tokens and oversized per-source staging", async () => {
    const job = await newJob();
    await expect(
      stageRefreshCandidates(job.id, "wrong-token", SOURCE_IDS[0]!, [candidate(1)], {
        sourceAttemptCount: 0,
      }),
    ).rejects.toThrow("not_owned");
    await expect(
      stageCandidates(
        job,
        SOURCE_IDS[0]!,
        Array.from({ length: 51 }, (_, i) => candidate(i)),
      ),
    ).rejects.toThrow("budget_exceeded");
    expect(await listRefreshJobCandidates(job.id, job.token)).toEqual([]);
  });

  test("enforces the per-source limit cumulatively and rejects terminal jobs", async () => {
    const job = await newJob();
    const sourceId = SOURCE_IDS[0]!;
    await stageCandidates(
      job,
      sourceId,
      Array.from({ length: 50 }, (_, i) => candidate(i, sourceId)),
    );
    await expect(stageCandidates(job, sourceId, [candidate(51, sourceId)])).rejects.toThrow(
      "refresh_source_attempt_fenced",
    );
    await db.update(refreshJobs).set({ status: "completed" }).where(eq(refreshJobs.id, job.id));
    await expect(freezeNextCandidateBatch(job.id, job.token, "signature-v1")).rejects.toThrow(
      "not_active",
    );
  });

  test("retries a failed fixed batch only within its bounded attempt count", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1)]);
    const batch = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).not.toBeNull();
    expect(await markCandidateBatchFailed(job.id, job.token, batch!.id, "temporary_failure")).toBe(
      true,
    );
    expect(await retryFailedCandidateBatch(job.id, job.token, batch!.id)).toBe(true);
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      attemptCount: 2,
    });
    expect(await markCandidateBatchFailed(job.id, job.token, batch!.id, "still_failed")).toBe(true);
    expect(await retryFailedCandidateBatch(job.id, job.token, batch!.id)).toBe(false);
  });

  test("defer for a pre-send rate wait does not consume a scoring attempt", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1)]);
    const batch = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      attemptCount: 1,
    });
    expect(await deferCandidateBatchForRateLimit(job.id, job.token, batch!.id, false)).toBe(true);
    expect(await getCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      attemptCount: 1,
    });
    expect(await deferCandidateBatchForRateLimit(job.id, job.token, batch!.id, true)).toBe(true);
    expect(await getCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      status: "pending",
      attemptCount: 1,
    });
  });

  test("recovers an unknown batch at most twice and fences a late previous result", async () => {
    const job = await newJob();
    await stageCandidates(job, SOURCE_IDS[0]!, [candidate(1)]);
    const batch = await freezeNextCandidateBatch(job.id, job.token, "signature-v1", true);
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      attemptCount: 1,
    });
    expect(
      await markCandidateBatchUnknown(job.id, job.token, batch!.id, "send_outcome_unknown", 1),
    ).toBe(true);
    expect(await recoverUnknownCandidateBatch(job.id, job.token, batch!.id, 2)).toBe("retry");
    expect(await claimCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      attemptCount: 2,
    });

    const candidates = await getBatchCandidates(job.id, job.token, batch!.id);
    const result = Object.fromEntries(candidates.map((row) => [row.id, { score: 1 }]));
    expect(await storeCandidateBatchResult(job.id, job.token, batch!.id, result, 1)).toBe(false);
    expect(
      await markCandidateBatchUnknown(job.id, job.token, batch!.id, "late_old_worker", 1),
    ).toBe(false);

    expect(
      await markCandidateBatchUnknown(job.id, job.token, batch!.id, "second_send_unknown", 2),
    ).toBe(true);
    expect(await recoverUnknownCandidateBatch(job.id, job.token, batch!.id, 2)).toBe("failed");
    expect(await getCandidateBatch(job.id, job.token, batch!.id)).toMatchObject({
      status: "failed",
      attemptCount: 2,
    });
    expect(await recoverUnknownCandidateBatch(job.id, job.token, batch!.id, 2)).toBe(
      "not-claimable",
    );
  });
});
