import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_IDS, type SourceId } from "@/lib/news/registry";

const mocks = vi.hoisted(() => ({
  bindWorkflowRun: vi.fn(),
  canStartRefreshSource: vi.fn(),
  claimRefreshSource: vi.fn(),
  finishRefreshJob: vi.fn(),
  getOwnedRefreshJob: vi.fn(),
  getRefreshJobSources: vi.fn(),
  isRefreshCacheInvalidationPending: vi.fn(),
  markNeedsReconciliation: vi.fn(),
  markRefreshSourceFailed: vi.fn(),
  markRefreshSourceInvalidated: vi.fn(),
  markRefreshSourceSaved: vi.fn(),
  markRefreshSourceUnknown: vi.fn(),
  recordAdapterStart: vi.fn(),
  setNextEligibleAt: vi.fn(),
  fetchSource: vi.fn(),
  revalidateTag: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("@/lib/db/repository/refresh-job-repository", () => mocks);
vi.mock("@/lib/news/fetch-service", () => ({ fetchSource: mocks.fetchSource }));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_test" }),
  sleep: mocks.sleep,
}));

import { SourceFetchError } from "@/lib/news/base/rss-fetcher";
import { aggregateRefreshWorkflow } from "@/workflows/aggregate-refresh";

function makeSourceRows(): Array<{
  sourceId: SourceId;
  status: "pending" | "executing" | "saved" | "invalidated" | "failed" | "unknown";
  adapterStartedAt: string | null;
  resultCount: number | null;
  errorCode: string | null;
}> {
  return SOURCE_IDS.map((sourceId) => ({
    sourceId,
    status: "pending" as const,
    adapterStartedAt: null,
    resultCount: null,
    errorCode: null,
  }));
}

describe("aggregate refresh workflow", () => {
  let sourceRows: ReturnType<typeof makeSourceRows>;
  let nowMs: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    sourceRows = makeSourceRows();
    mocks.bindWorkflowRun.mockResolvedValue(true);
    mocks.canStartRefreshSource.mockResolvedValue(true);
    mocks.getOwnedRefreshJob.mockResolvedValue({ status: "running" });
    mocks.getRefreshJobSources.mockImplementation(async () =>
      sourceRows.map((row) => ({ ...row })),
    );
    mocks.claimRefreshSource.mockImplementation(
      async (_jobId: string, _token: string, sourceId: SourceId) => {
        const row = sourceRows.find((item) => item.sourceId === sourceId)!;
        if (row.status !== "pending") return null;
        row.status = "executing";
        return { ...row };
      },
    );
    mocks.recordAdapterStart.mockImplementation(
      async (_jobId: string, _token: string, sourceId: SourceId, at: string) => {
        sourceRows.find((row) => row.sourceId === sourceId)!.adapterStartedAt = at;
        return true;
      },
    );
    mocks.fetchSource.mockImplementation(
      async (
        sourceId: SourceId,
        _onProgress: unknown,
        options: {
          beforeAdapterStart: () => Promise<boolean>;
          onAdapterStart: (startedAt: string) => Promise<boolean>;
        },
      ) => {
        if (!(await options.beforeAdapterStart())) throw new Error("start gate rejected");
        await options.onAdapterStart(new Date(nowMs).toISOString());
        return { results: [{ saved: 2, sourceId }] };
      },
    );
    mocks.markRefreshSourceSaved.mockImplementation(
      async (
        _jobId: string,
        _token: string,
        sourceId: SourceId,
        count: number,
        _savedAt: string,
        errorCode?: string,
      ) => {
        const row = sourceRows.find((item) => item.sourceId === sourceId)!;
        row.status = "saved";
        row.resultCount = count;
        row.errorCode = errorCode ?? null;
        return true;
      },
    );
    mocks.isRefreshCacheInvalidationPending.mockResolvedValue(true);
    mocks.markRefreshSourceInvalidated.mockImplementation(
      async (_jobId: string, _token: string, sourceId: SourceId) => {
        sourceRows.find((row) => row.sourceId === sourceId)!.status = "invalidated";
        return true;
      },
    );
    mocks.markRefreshSourceFailed.mockImplementation(
      async (_jobId: string, _token: string, sourceId: SourceId) => {
        sourceRows.find((row) => row.sourceId === sourceId)!.status = "failed";
        return true;
      },
    );
    mocks.markRefreshSourceUnknown.mockResolvedValue(true);
    mocks.markNeedsReconciliation.mockResolvedValue(true);
    mocks.setNextEligibleAt.mockResolvedValue(true);
    mocks.finishRefreshJob.mockResolvedValue(true);
    mocks.sleep.mockImplementation(async (durationMs: number) => {
      nowMs += durationMs;
    });
  });

  it.each([
    { processingMs: 40_000, expectedSleepMs: 30_000 },
    { processingMs: 80_000, expectedSleepMs: 0 },
  ])(
    "gates each adapter at its prior actual start plus 70 seconds with $processingMs ms processing",
    async ({ processingMs, expectedSleepMs }) => {
      mocks.fetchSource.mockImplementation(
        async (
          sourceId: SourceId,
          _onProgress: unknown,
          options: {
            beforeAdapterStart: () => Promise<boolean>;
            onAdapterStart: (startedAt: string) => Promise<boolean>;
          },
        ) => {
          if (!(await options.beforeAdapterStart())) throw new Error("start gate rejected");
          const startedAt = new Date(nowMs).toISOString();
          await options.onAdapterStart(startedAt);
          nowMs += processingMs;
          return { results: [{ saved: 2, sourceId }] };
        },
      );

      const result = await aggregateRefreshWorkflow("job-id", "execution-token");

      expect(result).toEqual({ status: "completed", failedSources: 0 });
      expect(mocks.bindWorkflowRun).toHaveBeenCalledWith("job-id", "execution-token", "wrun_test");
      expect(mocks.fetchSource.mock.calls.map((call) => call[0])).toEqual(SOURCE_IDS);
      expect(
        mocks.fetchSource.mock.calls.every((call) => call[2].strictAdapterErrors === true),
      ).toBe(true);
      expect(
        mocks.fetchSource.mock.calls.every((call) => typeof call[2].onAdapterStart === "function"),
      ).toBe(true);
      expect(
        mocks.fetchSource.mock.calls.every(
          (call) => typeof call[2].beforeAdapterStart === "function",
        ),
      ).toBe(true);
      expect(mocks.revalidateTag).toHaveBeenCalledTimes(SOURCE_IDS.length);
      expect(mocks.sleep).toHaveBeenCalledTimes(expectedSleepMs === 0 ? 0 : SOURCE_IDS.length - 1);
      const adapterStarts = mocks.recordAdapterStart.mock.calls.map((call) => Date.parse(call[3]));
      const sleepDurations = mocks.sleep.mock.calls.map((call) => call[0] as number);
      if (expectedSleepMs > 0) {
        expect(sleepDurations[0]).toBe(expectedSleepMs);
      }
      for (let index = 1; index < adapterStarts.length; index++) {
        expect(adapterStarts[index]).toBeGreaterThanOrEqual(adapterStarts[index - 1]! + 70_000);
      }
      expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "completed");
    },
  );

  it("does not sleep again when a durable sleep resumes after the gate", async () => {
    const callTimes: number[] = [];
    mocks.fetchSource.mockImplementation(
      async (
        sourceId: SourceId,
        _onProgress: unknown,
        options: {
          beforeAdapterStart: () => Promise<boolean>;
          onAdapterStart: (startedAt: string) => Promise<boolean>;
        },
      ) => {
        if (!(await options.beforeAdapterStart())) throw new Error("start gate rejected");
        callTimes.push(nowMs);
        await options.onAdapterStart(new Date(nowMs).toISOString());
        return { results: [{ saved: 1, sourceId }] };
      },
    );
    mocks.sleep.mockImplementationOnce(async (durationMs: number) => {
      nowMs += durationMs + 15_000;
    });

    await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(mocks.sleep).toHaveBeenCalledTimes(SOURCE_IDS.length - 1);
    expect(callTimes[1]).toBeGreaterThanOrEqual(callTimes[0]! + 70_000);
  });

  it("continues after a source-scoped failure and marks the final job partial", async () => {
    const failedSource = SOURCE_IDS[0];
    mocks.fetchSource.mockImplementation(async (sourceId: SourceId) => {
      if (sourceId === failedSource) throw new SourceFetchError(sourceId, "http", "HTTP 503");
      return { results: [{ saved: 1 }] };
    });

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.markRefreshSourceFailed).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      failedSource,
      "source-http",
    );
    expect(mocks.fetchSource).toHaveBeenCalledTimes(SOURCE_IDS.length);
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });

  it("records scoring errors as partial even when the service returns a normal response", async () => {
    const partialSource = SOURCE_IDS[0];
    mocks.fetchSource.mockImplementation(
      async (
        sourceId: SourceId,
        _onProgress: unknown,
        options: { onAdapterStart: (startedAt: string) => Promise<boolean> },
      ) => {
        await options.onAdapterStart(new Date().toISOString());
        return {
          results: [
            {
              saved: sourceId === partialSource ? 1 : 2,
              errors: sourceId === partialSource ? ["provider message"] : [],
              scoringErrors: sourceId === partialSource ? ["model message"] : [],
            },
          ],
        };
      },
    );

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.markRefreshSourceSaved).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      partialSource,
      1,
      expect.any(String),
      "source-processing-partial",
    );
    expect(mocks.markRefreshSourceInvalidated).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      partialSource,
    );
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });

  it("reuses a saved checkpoint after a workflow step result was not recorded", async () => {
    const savedSource = SOURCE_IDS[0];
    mocks.claimRefreshSource.mockImplementationOnce(async () => {
      // Simulate the prior service write and DB checkpoint winning just before
      // this workflow delivery tries to claim the source.
      sourceRows[0] = {
        sourceId: savedSource,
        status: "saved",
        adapterStartedAt: new Date(nowMs).toISOString(),
        resultCount: 3,
        errorCode: "source-processing-partial",
      };
      return null;
    });

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result.status).toBe("partial");
    expect(mocks.fetchSource.mock.calls.map((call) => call[0])).not.toContain(savedSource);
    expect(mocks.fetchSource).toHaveBeenCalledTimes(SOURCE_IDS.length - 1);
    expect(mocks.sleep.mock.calls[0]?.[0]).toBe(70_000);
    expect(mocks.markRefreshSourceInvalidated).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      savedSource,
    );
  });

  it("retains an ambiguous source outcome and fails closed", async () => {
    mocks.fetchSource.mockRejectedValue(new Error("database unavailable"));

    await expect(aggregateRefreshWorkflow("job-id", "execution-token")).rejects.toThrow(
      "Refresh source outcome needs reconciliation: zenn",
    );
    expect(mocks.markRefreshSourceUnknown).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      SOURCE_IDS[0],
      "source-outcome-unknown",
    );
    expect(mocks.markNeedsReconciliation).toHaveBeenCalled();
    expect(mocks.finishRefreshJob).not.toHaveBeenCalled();
  });
});
