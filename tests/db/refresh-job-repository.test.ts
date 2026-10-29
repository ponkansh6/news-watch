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
  releaseSingleRefresh,
  setNextEligibleAt,
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
      await recordAdapterStart(job.job!.id, job.executionToken!, firstSource, firstStart),
    ).toBe(true);
    expect(await recordAdapterStart(job.job!.id, "wrong-token", firstSource, firstStart)).toBe(
      false,
    );
    expect(await markRefreshSourceInvalidated(job.job!.id, job.executionToken!, firstSource)).toBe(
      false,
    );
    expect(await markRefreshSourceSaved(job.job!.id, "wrong-token", firstSource, 3)).toBe(false);
    expect(
      await markRefreshSourceSaved(
        job.job!.id,
        job.executionToken!,
        firstSource,
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
    expect(await markRefreshSourceInvalidated(job.job!.id, job.executionToken!, firstSource)).toBe(
      true,
    );
    expect((await getRefreshJobSources(job.job!.id))[0]?.errorCode).toBe("partial_source_result");
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, firstSource)).toBeNull();
    expect(
      await isRefreshCacheInvalidationPending(job.job!.id, job.executionToken!, firstSource),
    ).toBe(false);
    expect(await markRefreshSourceInvalidated(job.job!.id, job.executionToken!, firstSource)).toBe(
      false,
    );

    const nextStart = new Date(Date.parse(firstStart) + 70_000).toISOString();
    const nextEligibleAt = new Date(Date.parse(firstStart) + 70_001).toISOString();
    expect(await setNextEligibleAt(job.job!.id, job.executionToken!, nextEligibleAt)).toBe(true);
    const secondSource = SOURCE_IDS[1]!;
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, secondSource)).not.toBeNull();
    expect(
      await recordAdapterStart(job.job!.id, job.executionToken!, secondSource, nextStart),
    ).toBe(false);
    expect(
      await recordAdapterStart(job.job!.id, job.executionToken!, secondSource, nextEligibleAt),
    ).toBe(true);
  });

  test("ambiguous source completion is retained and never releases the active slot", async () => {
    const job = await newBoundJob();
    const sourceId = SOURCE_IDS[0]!;
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, sourceId)).not.toBeNull();
    expect(
      await markRefreshSourceUnknown(job.job!.id, job.executionToken!, sourceId, "outcome_unknown"),
    ).toBe(true);
    expect(await claimRefreshSource(job.job!.id, job.executionToken!, sourceId)).toBeNull();
    expect(await finishRefreshJob(job.job!.id, job.executionToken!, "failed")).toBe(false);
    expect((await getActiveRefreshSlot())?.ownerId).toBe(job.job!.id);
  });

  test("job terminalization releases the slot only with proven source completion", async () => {
    const job = await newBoundJob();
    let nextStart = Date.now();
    for (const [index, sourceId] of SOURCE_IDS.entries()) {
      expect(await claimRefreshSource(job.job!.id, job.executionToken!, sourceId)).not.toBeNull();
      const startedAt = new Date(nextStart).toISOString();
      expect(await recordAdapterStart(job.job!.id, job.executionToken!, sourceId, startedAt)).toBe(
        true,
      );
      expect(await markRefreshSourceSaved(job.job!.id, job.executionToken!, sourceId, 0)).toBe(
        true,
      );
      expect(await markRefreshSourceInvalidated(job.job!.id, job.executionToken!, sourceId)).toBe(
        true,
      );
      if (index < SOURCE_IDS.length - 1) {
        nextStart += 70_000;
        expect(
          await setNextEligibleAt(
            job.job!.id,
            job.executionToken!,
            new Date(nextStart).toISOString(),
          ),
        ).toBe(true);
      }
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
