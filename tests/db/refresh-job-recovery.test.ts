import { afterEach, describe, expect, test } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { SOURCE_IDS } from "@/lib/news/registry";
import {
  bindWorkflowRun,
  markNeedsReconciliation,
  startAggregateJob,
} from "@/lib/db/repository/refresh-job-repository";
import { reconcileTerminalRefreshJob } from "@/lib/db/repository/refresh-job-recovery";
import { refreshJobBatches, refreshJobSlot, refreshJobSources, refreshJobs } from "@/lib/db/schema";

const createdJobs: string[] = [];

async function heldJob() {
  const created = await startAggregateJob();
  if (created.kind !== "created" || !created.job || !created.executionToken) {
    throw new Error("failed to create recovery test job");
  }
  createdJobs.push(created.job.id);
  const runId = `recovery-run-${created.job.id}`;
  expect(await bindWorkflowRun(created.job.id, created.executionToken, runId)).toBe(true);
  expect(
    await markNeedsReconciliation(created.job.id, created.executionToken, "workflow_error"),
  ).toBe(true);
  return { jobId: created.job.id, runId };
}

async function markAllSourcesInvalidated(jobId: string) {
  await db
    .update(refreshJobSources)
    .set({ status: "invalidated", cacheInvalidatedAt: new Date().toISOString() })
    .where(eq(refreshJobSources.jobId, jobId));
}

afterEach(async () => {
  if (createdJobs.length) {
    await db.delete(refreshJobs).where(inArray(refreshJobs.id, createdJobs));
    createdJobs.length = 0;
  }
  await db.delete(refreshJobSlot).where(eq(refreshJobSlot.id, 1));
});

describe("refresh job recovery repository", () => {
  test("does not call a failed workflow completed when all source checkpoints are invalidated", async () => {
    const job = await heldJob();
    await markAllSourcesInvalidated(job.jobId);

    const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "failed");

    expect(result).toMatchObject({ kind: "reconciled", status: "partial" });
    expect(
      (await db.select().from(refreshJobs).where(eq(refreshJobs.id, job.jobId)))[0]?.status,
    ).toBe("partial");
  });

  test("marks completed workflow runs completed when every source is invalidated", async () => {
    const job = await heldJob();
    await markAllSourcesInvalidated(job.jobId);

    const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "completed");

    expect(result).toMatchObject({ kind: "reconciled", status: "completed" });
  });

  test("refuses release when the stored snapshot content or order is inconsistent", async () => {
    const job = await heldJob();
    await markAllSourcesInvalidated(job.jobId);
    await db
      .update(refreshJobs)
      .set({ sourceIds: JSON.stringify([...SOURCE_IDS].reverse()) })
      .where(eq(refreshJobs.id, job.jobId));

    const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "completed");

    expect(result).toEqual({ kind: "unsafe_checkpoint" });
    expect(
      (await db.select().from(refreshJobs).where(eq(refreshJobs.id, job.jobId)))[0]?.status,
    ).toBe("needs_reconciliation");
  });

  test("accepts a valid persisted snapshot from an older registry version", async () => {
    const job = await heldJob();
    const historicalIds = SOURCE_IDS.map((_, index) => `historic-source-${index}`);
    await db
      .update(refreshJobs)
      .set({ sourceIds: JSON.stringify(historicalIds) })
      .where(eq(refreshJobs.id, job.jobId));
    for (const [ordinal, sourceId] of historicalIds.entries()) {
      await db
        .update(refreshJobSources)
        .set({ sourceId })
        .where(and(eq(refreshJobSources.jobId, job.jobId), eq(refreshJobSources.ordinal, ordinal)));
    }
    await markAllSourcesInvalidated(job.jobId);

    const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "completed");

    expect(result).toMatchObject({ kind: "reconciled", status: "completed" });
  });

  test("refuses release when source ordinals no longer match the snapshot order", async () => {
    const job = await heldJob();
    await markAllSourcesInvalidated(job.jobId);
    await db
      .update(refreshJobSources)
      .set({ ordinal: 0 })
      .where(eq(refreshJobSources.jobId, job.jobId));

    const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "completed");

    expect(result).toEqual({ kind: "unsafe_checkpoint" });
    expect(
      (await db.select().from(refreshJobs).where(eq(refreshJobs.id, job.jobId)))[0]?.status,
    ).toBe("needs_reconciliation");
  });

  test.each(["pending", "running", "result_ready", "unknown"] as const)(
    "does not finalize or release the slot while a candidate batch is %s",
    async (status) => {
      const job = await heldJob();
      await markAllSourcesInvalidated(job.jobId);
      const now = new Date().toISOString();
      await db.insert(refreshJobBatches).values({
        id: `batch-${job.jobId}`,
        jobId: job.jobId,
        ordinal: 0,
        candidateIdsJson: "[]",
        scoringSignature: "signature-v1",
        status,
        resultJson: status === "result_ready" ? "[]" : null,
        attemptCount: 0,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });

      const result = await reconcileTerminalRefreshJob(job.jobId, job.runId, "completed");

      expect(result).toEqual({ kind: "unsafe_candidate_batch" });
      expect(
        (await db.select().from(refreshJobs).where(eq(refreshJobs.id, job.jobId)))[0]?.status,
      ).toBe("needs_reconciliation");
      expect(
        (await db.select().from(refreshJobSlot).where(eq(refreshJobSlot.id, 1)))[0]?.ownerId,
      ).toBe(job.jobId);
      expect(
        (
          await db.select().from(refreshJobSources).where(eq(refreshJobSources.jobId, job.jobId))
        ).every((source) => source.status === "invalidated"),
      ).toBe(true);
    },
  );
});
