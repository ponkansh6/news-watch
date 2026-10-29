import { afterEach, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { SOURCE_IDS } from "@/lib/news/registry";
import {
  bindWorkflowRun,
  claimRefreshSource,
  claimSingleRefresh,
  finishRefreshJob,
  getActiveRefreshSlot,
  getOwnedRefreshJob,
  getRefreshJobSources,
  isRefreshCacheInvalidationPending,
  markNeedsReconciliation,
  markRefreshSourceInvalidated,
  markRefreshSourceSaved,
  markRefreshSourceUnknown,
  recordAdapterStart,
  recoverRefreshSource,
  releaseSingleRefresh,
  startAggregateJob,
} from "@/lib/db/repository/refresh-job-repository";
import { refreshJobSlot, refreshJobs } from "@/lib/db/schema";

const createdJobs: string[] = [];

async function newBoundJob() {
  const started = await startAggregateJob();
  if (started.kind !== "created" || !started.job || !started.executionToken) {
    throw new Error("failed to create refresh test job");
  }
  createdJobs.push(started.job.id);
  const runId = `test-run-${started.job.id}`;
  expect(await bindWorkflowRun(started.job.id, started.executionToken, runId)).toBe(true);
  return { ...started, runId };
}

afterEach(async () => {
  if (createdJobs.length) {
    await db.delete(refreshJobs).where(inArray(refreshJobs.id, createdJobs));
    createdJobs.length = 0;
  }
  await db.delete(refreshJobSlot).where(eq(refreshJobSlot.id, 1));
});

describe("refresh job repository", () => {
  test("creates a registry-ordered source snapshot and joins duplicate aggregate requests", async () => {
    const first = await startAggregateJob();
    expect(first.kind).toBe("created");
    expect(first.job).not.toBeNull();
    expect(first.executionToken).toBeTruthy();
    createdJobs.push(first.job!.id);

    const sources = await getRefreshJobSources(first.job!.id);
    expect(sources.map((source) => source.sourceId)).toEqual(SOURCE_IDS);
    expect(sources.map((source) => source.ordinal)).toEqual(SOURCE_IDS.map((_, i) => i));
    expect(first.job!.status).toBe("enqueue_unknown");
    expect(first.job!.ownerTokenHash).not.toBe(first.executionToken);

    const duplicate = await startAggregateJob();
    expect(duplicate.kind).toBe("joined");
    expect(duplicate.job?.id).toBe(first.job!.id);
    expect(duplicate.executionToken).toBeUndefined();
  });

  test("serializes concurrent aggregate starts to one job", async () => {
    const [left, right] = await Promise.all([startAggregateJob(), startAggregateJob()]);
    const created = [left, right].filter((result) => result.kind === "created");
    const joined = [left, right].filter((result) => result.kind === "joined");
    expect(created).toHaveLength(1);
    expect(joined).toHaveLength(1);
    expect(left.job?.id).toBe(right.job?.id);
    createdJobs.push(created[0]!.job!.id);
    expect(await getRefreshJobSources(created[0]!.job!.id)).toHaveLength(SOURCE_IDS.length);
  });

  test("serializes a concurrent aggregate start against a single-source claim", async () => {
    const [aggregate, single] = await Promise.all([startAggregateJob(), claimSingleRefresh()]);
    if (aggregate.kind === "created") {
      createdJobs.push(aggregate.job!.id);
      expect(single.kind).toBe("busy");
      expect((await getActiveRefreshSlot())?.ownerId).toBe(aggregate.job!.id);
    } else {
      expect(aggregate.kind).toBe("busy");
      expect(single.kind).toBe("claimed");
      expect((await getActiveRefreshSlot())?.ownerId).toBe(single.ownerId);
    }
  });

  test("single-source and aggregate refreshes mutually exclude one another", async () => {
    const single = await claimSingleRefresh();
    expect(single.kind).toBe("claimed");
    expect(await startAggregateJob()).toMatchObject({ kind: "busy", job: null });
    expect(await releaseSingleRefresh(single.ownerId!, "wrong-token")).toBe(false);
    expect(await releaseSingleRefresh(single.ownerId!, single.ownerToken!)).toBe(true);

    const aggregate = await startAggregateJob();
    expect(aggregate.kind).toBe("created");
    createdJobs.push(aggregate.job!.id);
    await db
      .update(refreshJobSlot)
      .set({ acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .where(eq(refreshJobSlot.id, 1));
    expect(await claimSingleRefresh()).toEqual({ kind: "busy" });
  });

  test("recovers only an expired, identified Vercel request owner with an atomic token fence", async () => {
    const original = await claimSingleRefresh({ kind: "request-60-v1", deploymentId: "dpl-test" });
    expect(original.kind).toBe("claimed");
    await db
      .update(refreshJobSlot)
      .set({ recoveryAfter: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(refreshJobSlot.id, 1));

    const recovered = await claimSingleRefresh({ kind: "request-60-v1", deploymentId: "dpl-test" });
    expect(recovered.kind).toBe("claimed");
    expect(recovered.ownerId).not.toBe(original.ownerId);
    expect(await releaseSingleRefresh(original.ownerId!, original.ownerToken!)).toBe(false);
    expect((await getActiveRefreshSlot())?.ownerId).toBe(recovered.ownerId);
    expect(await releaseSingleRefresh(recovered.ownerId!, recovered.ownerToken!)).toBe(true);
  });

  test("does not recover unknown legacy owners or aggregate job owners", async () => {
    const legacy = await claimSingleRefresh();
    expect(legacy.kind).toBe("claimed");
    await db
      .update(refreshJobSlot)
      .set({ acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .where(eq(refreshJobSlot.id, 1));
    expect(await claimSingleRefresh({ kind: "request-60-v1", deploymentId: "dpl-test" })).toEqual({
      kind: "busy",
    });
    await releaseSingleRefresh(legacy.ownerId!, legacy.ownerToken!);

    const aggregate = await startAggregateJob();
    expect(aggregate.kind).toBe("created");
    createdJobs.push(aggregate.job!.id);
    await db
      .update(refreshJobSlot)
      .set({ acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .where(eq(refreshJobSlot.id, 1));
    expect(await claimSingleRefresh({ kind: "request-60-v1", deploymentId: "dpl-test" })).toEqual({
      kind: "busy",
    });
    expect((await getActiveRefreshSlot())?.ownerKind).toBe("job");
  });

  test("only the owner can bind a Workflow run and a job never adopts another run", async () => {
    const job = await startAggregateJob();
    expect(job.job).not.toBeNull();
    createdJobs.push(job.job!.id);
    expect(await bindWorkflowRun(job.job!.id, "wrong-token", "run-a")).toBe(false);
    expect(await bindWorkflowRun(job.job!.id, job.executionToken!, "run-a")).toBe(true);
    expect(await bindWorkflowRun(job.job!.id, job.executionToken!, "run-a")).toBe(true);
    expect(await bindWorkflowRun(job.job!.id, job.executionToken!, "run-b")).toBe(false);
    expect(await getOwnedRefreshJob(job.job!.id, "different-owner")).toBeNull();
    expect((await getOwnedRefreshJob(job.job!.id))?.workflowRunId).toBe("run-a");
  });

  test("needs-reconciliation preserves the slot and stores only a sanitized code", async () => {
    const job = await startAggregateJob();
    expect(job.kind).toBe("created");
    createdJobs.push(job.job!.id);

    expect(await markNeedsReconciliation(job.job!.id, "wrong-token", "unsafe detail")).toBe(false);
    expect(
      await markNeedsReconciliation(job.job!.id, job.executionToken!, "Gemini key=secret value"),
    ).toBe(true);
    const saved = await getOwnedRefreshJob(job.job!.id);
    expect(saved?.status).toBe("needs_reconciliation");
    expect(saved?.errorCode).toBe("unknown_error");
    expect(await markNeedsReconciliation(job.job!.id, job.executionToken!, "later_error")).toBe(
      true,
    );
    expect(saved?.errorCode).not.toContain("secret");
    expect(await bindWorkflowRun(job.job!.id, job.executionToken!, "late-run")).toBe(false);
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "failed")).toBe(false);
    expect((await getActiveRefreshSlot())?.ownerId).toBe(job.job!.id);
  });

  test("claims a source once, persists the real start gate, then invalidates separately", async () => {
    const job = await newBoundJob();
    const firstSource = SOURCE_IDS[0]!;
    const claim = await claimRefreshSource(job.job!.id, job.executionToken!, firstSource);
    expect(claim?.status).toBe("executing");
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, firstSource)).toBeNull();

    const firstStart = new Date().toISOString();
    expect(
      await recordAdapterStart(
        job.job!.id,
        job.executionToken!,
        firstSource,
        claim!.attemptCount,
        firstStart,
      ),
    ).toBe(true);
    expect(
      await recordAdapterStart(
        job.job!.id,
        "wrong-token",
        firstSource,
        claim!.attemptCount,
        firstStart,
      ),
    ).toBe(false);
    expect(
      await markRefreshSourceInvalidated(
        job.job!.id,
        job.executionToken!,
        firstSource,
        claim!.attemptCount,
      ),
    ).toBe(false);
    expect(
      await markRefreshSourceSaved(job.job!.id, "wrong-token", firstSource, claim!.attemptCount, 3),
    ).toBe(false);
    expect(
      await markRefreshSourceSaved(
        job.job!.id,
        job.executionToken!,
        firstSource,
        claim!.attemptCount,
        3,
        undefined,
        "Partial_Source_Result",
      ),
    ).toBe(true);
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, firstSource)).toBeNull();
    expect((await getRefreshJobSources(job.job!.id))[0]?.errorCode).toBe("partial_source_result");
    // Simulate an invalidation step failure: the saved checkpoint remains retryable.
    expect(
      await isRefreshCacheInvalidationPending(job.job!.id, job.executionToken!, firstSource),
    ).toBe(true);
    expect(await isRefreshCacheInvalidationPending(job.job!.id, "wrong-token", firstSource)).toBe(
      false,
    );
    expect(
      await markRefreshSourceInvalidated(
        job.job!.id,
        job.executionToken!,
        firstSource,
        claim!.attemptCount,
      ),
    ).toBe(true);
    expect((await getRefreshJobSources(job.job!.id))[0]?.errorCode).toBe("partial_source_result");
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, firstSource)).toBeNull();
    expect(
      await isRefreshCacheInvalidationPending(job.job!.id, job.executionToken!, firstSource),
    ).toBe(false);
    expect(
      await markRefreshSourceInvalidated(
        job.job!.id,
        job.executionToken!,
        firstSource,
        claim!.attemptCount,
      ),
    ).toBe(false);

    const nextStart = new Date(Date.parse(firstStart) + 1).toISOString();
    const secondSource = SOURCE_IDS[1]!;
    const nextClaim = await claimRefreshSource(job.job!.id, job.executionToken!, secondSource);
    expect(nextClaim).not.toBeNull();
    expect(
      await recordAdapterStart(
        job.job!.id,
        job.executionToken!,
        secondSource,
        nextClaim!.attemptCount,
        nextStart,
      ),
    ).toBe(true);
  });

  test("ambiguous source completion is retained and never releases the active slot", async () => {
    const job = await newBoundJob();
    const sourceId = SOURCE_IDS[0]!;
    const claim = await claimRefreshSource(job.job!.id, job.executionToken!, sourceId);
    expect(claim).not.toBeNull();
    expect(
      await markRefreshSourceUnknown(
        job.job!.id,
        job.executionToken!,
        sourceId,
        "outcome_unknown",
        claim!.attemptCount,
      ),
    ).toBe(true);
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, sourceId)).toBeNull();
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "failed")).toBe(false);
    expect((await getActiveRefreshSlot())?.ownerId).toBe(job.job!.id);
  });

  test("automatically retries an uncertain read-only source at most twice and fences late workers", async () => {
    const job = await newBoundJob();
    const sourceId = SOURCE_IDS[0]!;
    const first = await claimRefreshSource(job.job!.id, job.executionToken!, sourceId);
    expect(first?.attemptCount).toBe(1);
    expect(
      await recordAdapterStart(job.job!.id, job.executionToken!, sourceId, first!.attemptCount),
    ).toBe(true);
    expect(
      await markRefreshSourceUnknown(
        job.job!.id,
        job.executionToken!,
        sourceId,
        "fetch_outcome_unknown",
        first!.attemptCount,
      ),
    ).toBe(true);

    expect(
      await recoverRefreshSource(job.job!.id, job.executionToken!, sourceId, first!.attemptCount),
    ).toEqual({ kind: "retry", attemptCount: 1 });
    const second = await claimRefreshSource(job.job!.id, job.executionToken!, sourceId);
    expect(second?.attemptCount).toBe(2);
    expect(
      await recordAdapterStart(job.job!.id, job.executionToken!, sourceId, first!.attemptCount),
    ).toBe(false);
    expect(
      await recordAdapterStart(job.job!.id, job.executionToken!, sourceId, second!.attemptCount),
    ).toBe(true);

    expect(
      await markRefreshSourceUnknown(
        job.job!.id,
        job.executionToken!,
        sourceId,
        "fetch_outcome_unknown",
        second!.attemptCount,
      ),
    ).toBe(true);
    expect(
      await recoverRefreshSource(job.job!.id, job.executionToken!, sourceId, second!.attemptCount),
    ).toEqual({ kind: "failed", attemptCount: 2 });
    expect((await getRefreshJobSources(job.job!.id))[0]?.status).toBe("failed");
    expect((await getRefreshJobSources(job.job!.id))[0]?.errorCode).toBe("source_retry_exhausted");
  });

  test("job terminalization releases the slot only with proven source completion", async () => {
    const job = await newBoundJob();
    let nextStart = Date.now();
    for (const sourceId of SOURCE_IDS) {
      const sourceClaim = await claimRefreshSource(job.job!.id, job.executionToken!, sourceId);
      expect(sourceClaim).not.toBeNull();
      const startedAt = new Date(nextStart).toISOString();
      expect(
        await recordAdapterStart(
          job.job!.id,
          job.executionToken!,
          sourceId,
          sourceClaim!.attemptCount,
          startedAt,
        ),
      ).toBe(true);
      expect(
        await markRefreshSourceSaved(
          job.job!.id,
          job.executionToken!,
          sourceId,
          sourceClaim!.attemptCount,
          0,
        ),
      ).toBe(true);
      expect(
        await markRefreshSourceInvalidated(
          job.job!.id,
          job.executionToken!,
          sourceId,
          sourceClaim!.attemptCount,
        ),
      ).toBe(true);
      nextStart += 1;
    }
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "completed")).toBe(true);
    expect(await getActiveRefreshSlot()).toMatchObject({ id: 1, ownerId: null });

    const nextJob = await startAggregateJob();
    expect(nextJob.kind).toBe("created");
    createdJobs.push(nextJob.job!.id);
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "completed")).toBe(true);
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "failed")).toBe(false);
    expect(await finishRefreshJob(job.job!.id, "wrong-token", "completed")).toBe(false);
    expect((await getActiveRefreshSlot())?.ownerId).toBe(nextJob.job!.id);
  });
});
