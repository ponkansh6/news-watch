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
  markRefreshSourceUnknown: vi.fn(),
  recoverRefreshSource: vi.fn(),
  recordAdapterStart: vi.fn(),
  collectRefreshCandidates: vi.fn(),
  persistIdentifiedCandidateBatch: vi.fn(),
  refreshStagedSourceRecency: vi.fn(),
  gcStaleArticles: vi.fn(),
  scoreArticlesById: vi.fn(),
  claimCandidateBatch: vi.fn(),
  deferCandidateBatchForRateLimit: vi.fn(),
  freezeNextCandidateBatch: vi.fn(),
  getBatchCandidates: vi.fn(),
  getCandidateBatch: vi.fn(),
  listCandidateBatches: vi.fn(),
  listRefreshJobCandidates: vi.fn(),
  summarizePendingCandidateSignatures: vi.fn(),
  markCandidateBatchFailed: vi.fn(),
  markCandidateBatchSaved: vi.fn(),
  markCandidateBatchUnknown: vi.fn(),
  recoverUnknownCandidateBatch: vi.fn(),
  retryFailedCandidateBatch: vi.fn(),
  storeCandidateBatchResult: vi.fn(),
  revalidateTag: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("@/lib/db/repository/refresh-job-repository", () => mocks);
vi.mock("@/lib/db/repository/refresh-candidate-repository", () => mocks);
vi.mock("@/lib/news/fetch-service", () => ({
  collectRefreshCandidates: mocks.collectRefreshCandidates,
  persistIdentifiedCandidateBatch: mocks.persistIdentifiedCandidateBatch,
  refreshStagedSourceRecency: mocks.refreshStagedSourceRecency,
}));
vi.mock("@/app/api/fetch-news/pipeline/maintenance", () => ({
  gcStaleArticles: mocks.gcStaleArticles,
}));
vi.mock("@/lib/llm", () => ({ scoreArticlesById: mocks.scoreArticlesById }));
vi.mock("@/lib/llm/client", () => ({
  geminiLeaseEvidence: (kind: string) => ({ kind, deploymentId: "test-deployment" }),
  GeminiSlotWaitError: class GeminiSlotWaitError extends Error {
    recoverable: boolean;
    retryAfterMs: number | undefined;
    attemptsSent: number;
    constructor(recoverable: boolean, retryAfterMs?: number, attemptsSent = 0) {
      super("wait for Gemini slot");
      this.retryAfterMs = retryAfterMs;
      this.attemptsSent = attemptsSent;
      this.recoverable = recoverable;
    }
  },
}));
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
import { GeminiSlotWaitError } from "@/lib/llm/client";
import { aggregateRefreshWorkflow } from "@/workflows/aggregate-refresh";

function makeSourceRows() {
  return SOURCE_IDS.map((sourceId) => ({
    sourceId,
    status: "pending" as "pending" | "executing" | "saved" | "invalidated" | "failed" | "unknown",
    adapterStartedAt: null as string | null,
    resultCount: null as number | null,
    errorCode: null as string | null,
    attemptCount: 0,
  }));
}

describe("aggregate refresh workflow", () => {
  let sourceRows: ReturnType<typeof makeSourceRows>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
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
        row.attemptCount += 1;
        return { ...row };
      },
    );
    mocks.recordAdapterStart.mockImplementation(
      async (
        _jobId: string,
        _token: string,
        sourceId: SourceId,
        _attemptCount: number,
        at: string,
      ) => {
        sourceRows.find((row) => row.sourceId === sourceId)!.adapterStartedAt = at;
        return true;
      },
    );
    mocks.collectRefreshCandidates.mockImplementation(
      async (
        sourceId: SourceId,
        _jobId: string,
        _token: string,
        options: {
          beforeAdapterStart: () => Promise<boolean>;
          onAdapterStart: (startedAt: string) => Promise<boolean>;
          sourceAttemptCount: number;
        },
      ) => {
        if (!(await options.beforeAdapterStart())) throw new Error("start checkpoint rejected");
        await options.onAdapterStart(new Date().toISOString());
        const row = sourceRows.find((item) => item.sourceId === sourceId)!;
        row.status = "saved";
        row.resultCount = 0;
        row.attemptCount = options.sourceAttemptCount;
        row.errorCode = null;
        return { fetched: 2, selected: 0, deferred: 0, signature: "sig" };
      },
    );
    mocks.isRefreshCacheInvalidationPending.mockResolvedValue(true);
    mocks.refreshStagedSourceRecency.mockResolvedValue(0);
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
    mocks.recoverRefreshSource.mockImplementation(
      async (
        _jobId: string,
        _token: string,
        sourceId: SourceId,
        expectedAttemptCount: number,
        maxAttempts: number,
      ) => {
        const row = sourceRows.find((item) => item.sourceId === sourceId)!;
        if (row.attemptCount !== expectedAttemptCount) return { kind: "unchanged" };
        if (
          (row.status === "unknown" || row.status === "executing") &&
          row.attemptCount < maxAttempts
        ) {
          row.status = "pending";
          return { kind: "retry", attemptCount: row.attemptCount };
        }
        if (row.status === "unknown" || row.status === "executing") {
          row.status = "failed";
          row.errorCode = "source-retry-exhausted";
          return { kind: "failed", attemptCount: row.attemptCount };
        }
        return { kind: "unchanged" };
      },
    );
    mocks.markNeedsReconciliation.mockResolvedValue(true);
    mocks.finishRefreshJob.mockResolvedValue(true);
    mocks.gcStaleArticles.mockResolvedValue({ deleted: 0 });
    mocks.listCandidateBatches.mockResolvedValue([]);
    mocks.listRefreshJobCandidates.mockResolvedValue([]);
    mocks.summarizePendingCandidateSignatures.mockResolvedValue([]);
    mocks.freezeNextCandidateBatch.mockResolvedValue(null);
    mocks.retryFailedCandidateBatch.mockResolvedValue(false);
    mocks.sleep.mockResolvedValue(undefined);
  });

  it("collects sources sequentially without the obsolete 70-second source gate", async () => {
    const result = await aggregateRefreshWorkflow("job-id", "execution-token");
    expect(result).toEqual({ status: "completed", failedSources: 0 });
    expect(mocks.collectRefreshCandidates.mock.calls.map((call) => call[0])).toEqual(SOURCE_IDS);
    expect(
      mocks.collectRefreshCandidates.mock.calls.every((call) => call[3].strictAdapterErrors),
    ).toBe(true);
    expect(mocks.refreshStagedSourceRecency.mock.calls.map((call) => call[2])).toEqual(SOURCE_IDS);
    expect(mocks.sleep).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(SOURCE_IDS.length);
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "completed");
  });

  it("replays recency refresh for an already saved source without fetching again", async () => {
    sourceRows[0]!.status = "saved";
    sourceRows[0]!.resultCount = 3;

    await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(mocks.collectRefreshCandidates.mock.calls.map((call) => call[0])).toEqual(
      SOURCE_IDS.slice(1),
    );
    expect(mocks.refreshStagedSourceRecency.mock.calls.map((call) => call[2])).toEqual(SOURCE_IDS);
  });

  it("does not complete when durable recency refresh fails", async () => {
    mocks.refreshStagedSourceRecency.mockRejectedValueOnce(
      new Error("recency database unavailable"),
    );

    await expect(aggregateRefreshWorkflow("job-id", "execution-token")).rejects.toThrow();

    expect(mocks.markNeedsReconciliation).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "workflow-requires-reconciliation",
    );
    expect(mocks.finishRefreshJob).not.toHaveBeenCalled();
  });

  it("emits a failed collection timing metric when recovery aborts the source loop", async () => {
    sourceRows[0]!.status = "unknown";
    sourceRows[0]!.attemptCount = 1;
    mocks.recoverRefreshSource.mockRejectedValueOnce(new Error("recovery store unavailable"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      aggregateRefreshWorkflow("job-metric-failed", "execution-token"),
    ).rejects.toThrow();

    const metric = info.mock.calls
      .filter(([prefix]) => prefix === "[aggregate-collection-workflow-metric]")
      .map(([, event]) => JSON.parse(String(event)) as Record<string, unknown>)[0];
    expect(metric).toMatchObject({
      sourceCount: SOURCE_IDS.length,
      outcome: "failed",
      recoveryWaitRequestedMs: 0,
    });
    expect(metric?.collectionElapsedMs).toEqual(expect.any(Number));
  });

  it("collects a failed source as partial and continues to the remaining sources", async () => {
    const failedSource = SOURCE_IDS[0];
    mocks.collectRefreshCandidates.mockImplementation(async (sourceId: SourceId) => {
      if (sourceId === failedSource) throw new SourceFetchError(sourceId, "http", "HTTP 503");
      return { fetched: 1, selected: 0, deferred: 0, signature: "sig" };
    });
    const result = await aggregateRefreshWorkflow("job-id", "execution-token");
    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.markRefreshSourceFailed).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      failedSource,
      "source-http",
      1,
    );
    expect(mocks.collectRefreshCandidates).toHaveBeenCalledTimes(SOURCE_IDS.length);
  });

  it("rereads the atomic source checkpoint after an ambiguous staging response", async () => {
    const sourceId = SOURCE_IDS[0]!;
    mocks.collectRefreshCandidates.mockImplementationOnce(async () => {
      const row = sourceRows.find((item) => item.sourceId === sourceId)!;
      row.status = "saved";
      row.resultCount = 4;
      throw new Error("database response lost after commit");
    });

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "completed", failedSources: 0 });
    expect(mocks.collectRefreshCandidates).toHaveBeenCalledTimes(SOURCE_IDS.length);
    expect(mocks.markRefreshSourceUnknown).not.toHaveBeenCalled();
    expect(mocks.markNeedsReconciliation).not.toHaveBeenCalled();
  });

  it("automatically retries an uncertain source once and completes without reconciliation", async () => {
    const sourceId = SOURCE_IDS[0]!;
    let calls = 0;
    mocks.collectRefreshCandidates.mockImplementation(
      async (
        id: SourceId,
        _jobId: string,
        _token: string,
        options: {
          beforeAdapterStart: () => Promise<boolean>;
          onAdapterStart: (startedAt: string) => Promise<boolean>;
          sourceAttemptCount: number;
        },
      ) => {
        calls += 1;
        const row = sourceRows.find((item) => item.sourceId === id)!;
        if (id === sourceId && calls === 1) {
          row.status = "unknown";
          row.errorCode = "source-outcome-unknown";
          throw new Error("source response outcome lost");
        }
        row.status = "saved";
        row.resultCount = 1;
        row.attemptCount = options.sourceAttemptCount;
        row.errorCode = null;
        return { fetched: 1, selected: 0, deferred: 0, signature: "sig" };
      },
    );

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "completed", failedSources: 0 });
    expect(
      mocks.collectRefreshCandidates.mock.calls.filter((call) => call[0] === sourceId),
    ).toHaveLength(2);
    expect(mocks.recoverRefreshSource).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      sourceId,
      1,
      2,
    );
    expect(mocks.sleep).toHaveBeenCalledWith(1_000);
    expect(mocks.markNeedsReconciliation).not.toHaveBeenCalled();
  });

  it("stops uncertain-source recovery after the persistent attempt limit", async () => {
    const sourceId = SOURCE_IDS[0]!;
    sourceRows[0]!.status = "unknown";
    sourceRows[0]!.attemptCount = 2;

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.collectRefreshCandidates.mock.calls.some((call) => call[0] === sourceId)).toBe(
      false,
    );
    expect(sourceRows[0]!.status).toBe("failed");
    expect(mocks.markNeedsReconciliation).not.toHaveBeenCalled();
  });

  it("freezes full batches first and flushes the final tail", async () => {
    const fullBatch = { id: "full", status: "pending" };
    const tailBatch = { id: "tail", status: "pending" };
    mocks.summarizePendingCandidateSignatures
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 51, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 51, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 50 }])
      .mockResolvedValueOnce([]);
    mocks.freezeNextCandidateBatch
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(tailBatch)
      .mockResolvedValueOnce(null);
    mocks.listCandidateBatches.mockResolvedValue([]);
    mocks.getCandidateBatch.mockImplementation(
      async (_jobId: string, _token: string, id: string) => ({
        id,
        status: "saved",
        resultJson: null,
        errorCode: null,
      }),
    );

    await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(mocks.freezeNextCandidateBatch.mock.calls.map((call) => call[3])).toEqual([false, true]);
  });

  it.each([false, true])(
    "emits a replay-deduplicable SDK-boundary metric without article content (logger throws: %s)",
    async (loggerThrows) => {
      mocks.summarizePendingCandidateSignatures
        .mockResolvedValueOnce([
          { scoringSignature: "sig-a", candidateCount: 1, firstOrdinal: 0 },
          { scoringSignature: "sig-b", candidateCount: 1, firstOrdinal: 1 },
        ])
        .mockResolvedValueOnce([
          { scoringSignature: "sig-a", candidateCount: 1, firstOrdinal: 0 },
          { scoringSignature: "sig-b", candidateCount: 1, firstOrdinal: 1 },
        ])
        .mockResolvedValueOnce([{ scoringSignature: "sig-b", candidateCount: 1, firstOrdinal: 1 }])
        .mockResolvedValueOnce([]);
      mocks.freezeNextCandidateBatch
        .mockResolvedValueOnce({ id: "batch-failed", status: "pending" })
        .mockResolvedValueOnce({ id: "batch-metric", status: "pending" })
        .mockResolvedValue(null);
      mocks.listCandidateBatches.mockResolvedValue([]);
      const candidateBatchReads = new Map<string, number>();
      const terminalFailedBatchIds = new Set<string>();
      mocks.getCandidateBatch.mockImplementation(
        async (_jobId: string, _token: string, id: string) => {
          const reads = (candidateBatchReads.get(id) ?? 0) + 1;
          candidateBatchReads.set(id, reads);
          if (reads === 1 || (id === "batch-failed" && !terminalFailedBatchIds.has(id))) {
            return {
              id,
              status: "pending",
              attemptCount: 0,
              resultJson: null,
              errorCode: null,
            };
          }
          if (id === "batch-failed") {
            return {
              id,
              status: "failed",
              attemptCount: 1,
              resultJson: null,
              errorCode: "candidate-batch-scoring-failed",
            };
          }
          return {
            id,
            status: "result_ready",
            attemptCount: 1,
            resultJson: JSON.stringify({
              c2: { summary: "safe summary", usefulness: 2, ntt_relevance: 3, reason: "safe" },
            }),
            errorCode: null,
          };
        },
      );
      mocks.claimCandidateBatch.mockImplementation(
        async (_jobId: string, _token: string, id: string) => ({
          id,
          status: "running",
          attemptCount: 1,
        }),
      );
      mocks.getBatchCandidates.mockImplementation(
        async (_jobId: string, _token: string, id: string) => [
          {
            id: id === "batch-failed" ? "c1" : "c2",
            payloadJson: JSON.stringify({
              title: "private article title",
              description: "private article description",
              preferenceSection: "private preference",
            }),
          },
        ],
      );
      mocks.scoreArticlesById
        .mockRejectedValueOnce(new Error("expected batch failure"))
        .mockImplementation(async (_articles, _preference, options) => {
          options.onHttpAttempt();
          options.onHttpAttempt();
          return [
            {
              id: "c2",
              score: {
                summary: "safe summary",
                usefulness: 2,
                ntt_relevance: 3,
                reason: "safe",
              },
            },
          ];
        });
      mocks.markCandidateBatchFailed.mockImplementation(
        async (_jobId: string, _token: string, id: string) => {
          terminalFailedBatchIds.add(id);
          return true;
        },
      );
      mocks.storeCandidateBatchResult.mockResolvedValue(true);
      mocks.persistIdentifiedCandidateBatch.mockResolvedValue(1);
      mocks.markCandidateBatchSaved.mockResolvedValue(true);
      const info = vi.spyOn(console, "info").mockImplementation(() => {
        if (loggerThrows) throw new Error("logger unavailable");
      });

      const result = await aggregateRefreshWorkflow("job-metric", "execution-token");

      expect(result.status).toBe("partial");
      expect(mocks.persistIdentifiedCandidateBatch).toHaveBeenCalledTimes(1);
      if (!loggerThrows) {
        const metrics = info.mock.calls
          .filter(([prefix]) => prefix === "[aggregate-presend-metric]")
          .map(([, event]) => JSON.parse(String(event)) as Record<string, unknown>);
        expect(metrics).toHaveLength(2);
        expect(metrics.map((event) => event.eventId)).toEqual([
          "job-metric:batch-metric:1:0:1:sdk-call",
          "job-metric:batch-metric:1:0:2:sdk-call",
        ]);
        expect(metrics[0]).toMatchObject({
          boundary: "previous_batch_terminal",
          internalRetryIndex: 1,
          measurement: "sdk_call_before_generateContent_not_http_start",
          elapsedIncludes: "shared_slot_claim_and_attempt_checkpoint",
        });
        expect(metrics[0].boundaryClockRelation).toMatch(
          /observed_before_boundary|observed_after_or_equal_boundary/,
        );
        const serializedMetrics = JSON.stringify(metrics);
        expect(serializedMetrics).not.toContain("private article");
        expect(serializedMetrics).not.toContain("private preference");
      }
    },
  );

  it("durably sleeps and retries the same batch when the shared Gemini slot is busy", async () => {
    const batch = {
      id: "batch-1",
      status: "pending",
      attemptCount: 0,
      resultJson: null,
      errorCode: null,
    };
    mocks.summarizePendingCandidateSignatures
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([]);
    mocks.freezeNextCandidateBatch.mockResolvedValueOnce(batch).mockResolvedValue(null);
    mocks.getCandidateBatch.mockImplementation(async () => ({ ...batch }));
    mocks.claimCandidateBatch.mockResolvedValue({ ...batch, status: "running", attemptCount: 1 });
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          preferenceSection: "",
        }),
      },
    ]);
    mocks.scoreArticlesById
      .mockRejectedValueOnce(new GeminiSlotWaitError(true, 1_500))
      .mockResolvedValueOnce([
        { id: "c1", score: { summary: "s", usefulness: 2, ntt_relevance: 3, reason: "r" } },
      ]);
    mocks.deferCandidateBatchForRateLimit.mockResolvedValue(true);
    mocks.storeCandidateBatchResult.mockResolvedValue(true);
    mocks.persistIdentifiedCandidateBatch.mockResolvedValue(1);
    mocks.markCandidateBatchSaved.mockResolvedValue(true);
    mocks.getCandidateBatch.mockImplementation(
      async (_jobId: string, _token: string, _id: string) => ({
        ...batch,
        status: mocks.storeCandidateBatchResult.mock.calls.length ? "result_ready" : "pending",
        resultJson: JSON.stringify({
          c1: { summary: "s", usefulness: 2, ntt_relevance: 3, reason: "r" },
        }),
      }),
    );
    mocks.sleep.mockResolvedValue(undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result.status).toBe("completed");
    expect(mocks.deferCandidateBatchForRateLimit).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "batch-1",
      false,
    );
    expect(mocks.sleep).toHaveBeenCalledWith(1_500);
    expect(mocks.scoreArticlesById).toHaveBeenCalledTimes(2);
    const waitMetric = info.mock.calls
      .filter(([prefix]) => prefix === "[aggregate-presend-metric]")
      .map(([, event]) => JSON.parse(String(event)) as Record<string, unknown>)
      .find((event) => event.event === "shared_slot_wait");
    expect(waitMetric).toMatchObject({
      jobId: "job-id",
      batchId: "batch-1",
      boundary: "collection_complete",
      requestedWaitMs: 1_500,
      attemptsSent: 0,
    });
  });

  it("fails the batch after a bounded number of durable rate-limit waits", async () => {
    const batch = {
      id: "stuck-slot",
      status: "pending",
      attemptCount: 0,
      resultJson: null,
      errorCode: null,
    };
    mocks.summarizePendingCandidateSignatures
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([]);
    mocks.freezeNextCandidateBatch.mockResolvedValueOnce(batch).mockResolvedValue(null);
    mocks.listCandidateBatches.mockResolvedValue([]);
    mocks.getCandidateBatch.mockResolvedValue({ ...batch });
    mocks.claimCandidateBatch.mockResolvedValue({ ...batch, status: "running", attemptCount: 1 });
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          preferenceSection: "",
        }),
      },
    ]);
    mocks.scoreArticlesById.mockRejectedValue(new GeminiSlotWaitError(true, 1_500));
    mocks.deferCandidateBatchForRateLimit.mockResolvedValue(true);
    mocks.markCandidateBatchFailed.mockResolvedValue(true);

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.sleep).toHaveBeenCalledTimes(2);
    expect(mocks.scoreArticlesById).toHaveBeenCalledTimes(3);
    expect(mocks.markCandidateBatchFailed).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "stuck-slot",
      "gemini-rate-limit-wait-exhausted",
    );
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });

  it("fails immediately when a busy slot has no automatic recovery deadline", async () => {
    const batch = {
      id: "unknown-owner",
      status: "pending",
      attemptCount: 0,
      resultJson: null,
      errorCode: null,
    };
    mocks.summarizePendingCandidateSignatures
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([]);
    mocks.freezeNextCandidateBatch.mockResolvedValueOnce(batch).mockResolvedValue(null);
    mocks.listCandidateBatches.mockResolvedValue([]);
    mocks.getCandidateBatch.mockResolvedValue({ ...batch });
    mocks.claimCandidateBatch.mockResolvedValue({ ...batch, status: "running", attemptCount: 1 });
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          preferenceSection: "",
        }),
      },
    ]);
    mocks.scoreArticlesById.mockRejectedValue(new GeminiSlotWaitError(false));
    mocks.markCandidateBatchFailed.mockResolvedValue(true);

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.sleep).not.toHaveBeenCalled();
    expect(mocks.deferCandidateBatchForRateLimit).not.toHaveBeenCalled();
    expect(mocks.markCandidateBatchFailed).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "unknown-owner",
      "gemini-owner-unrecoverable",
      1,
    );
  });

  it("automatically marks an ambiguous replay failed after the bounded retry budget", async () => {
    mocks.listCandidateBatches.mockResolvedValue([{ id: "uncertain", status: "running" }]);
    let status = "running";
    mocks.getCandidateBatch.mockImplementation(async () => ({
      id: "uncertain",
      status,
      resultJson: null,
      attemptCount: 2,
    }));
    mocks.markCandidateBatchUnknown.mockResolvedValue(true);
    mocks.recoverUnknownCandidateBatch.mockImplementation(async () => {
      status = "failed";
      return "failed";
    });
    const result = await aggregateRefreshWorkflow("job-id", "execution-token");
    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.markCandidateBatchUnknown).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "uncertain",
      "batch-replay-ambiguous",
      2,
    );
    expect(mocks.recoverUnknownCandidateBatch).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "uncertain",
      2,
    );
    expect(mocks.scoreArticlesById).not.toHaveBeenCalled();
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });

  it("automatically retries one ambiguous batch result and persists the recovered result", async () => {
    let status = "unknown";
    let attemptCount = 1;
    const storedResult = {
      c1: { summary: "summary", usefulness: 3, ntt_relevance: 2, reason: "reason" },
    };
    mocks.listCandidateBatches.mockResolvedValue([{ id: "uncertain", status: "unknown" }]);
    mocks.getCandidateBatch.mockImplementation(async () => ({
      id: "uncertain",
      status,
      attemptCount,
      resultJson: status === "result_ready" ? JSON.stringify(storedResult) : null,
      errorCode: null,
    }));
    mocks.recoverUnknownCandidateBatch.mockImplementation(async () => {
      status = "pending";
      return "retry";
    });
    mocks.claimCandidateBatch.mockImplementation(async () => {
      status = "running";
      attemptCount = 2;
      return { id: "uncertain", status, attemptCount };
    });
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          preferenceSection: "",
        }),
      },
    ]);
    mocks.scoreArticlesById.mockResolvedValue([{ id: "c1", score: storedResult.c1 }]);
    mocks.storeCandidateBatchResult.mockImplementation(async () => {
      status = "result_ready";
      return true;
    });
    mocks.persistIdentifiedCandidateBatch.mockResolvedValue(1);
    mocks.markCandidateBatchSaved.mockImplementation(async () => {
      status = "saved";
      return true;
    });

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "completed", failedSources: 0 });
    expect(mocks.recoverUnknownCandidateBatch).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).toHaveBeenCalledWith(1_000);
    expect(mocks.scoreArticlesById).toHaveBeenCalledTimes(1);
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "completed");
  });

  it("marks the job partial when candidate batches fail instead of finishing cleanly", async () => {
    mocks.listCandidateBatches.mockResolvedValue([{ id: "failed", status: "failed" }]);
    mocks.getCandidateBatch.mockResolvedValue({
      id: "failed",
      status: "failed",
      resultJson: null,
      errorCode: "scoring-failed",
    });
    mocks.retryFailedCandidateBatch.mockResolvedValue(false);

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });

  it("replays a persisted batch result without another Gemini request", async () => {
    let batchStatus = "result_ready";
    const storedResult = JSON.stringify({
      c1: { summary: "summary", usefulness: 2, ntt_relevance: 3, reason: "reason" },
    });
    mocks.listCandidateBatches.mockImplementation(async () => [
      { id: "ready", status: batchStatus },
    ]);
    mocks.getCandidateBatch.mockImplementation(async () => ({
      id: "ready",
      status: batchStatus,
      resultJson: storedResult,
      errorCode: null,
    }));
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          url: "https://example.com/article",
          publishedAt: "2026-01-01T00:00:00.000Z",
          sourceName: "Example",
        }),
        contentHash: "hash",
        scoringSignature: "signature",
        representativeSourceId: SOURCE_IDS[0],
      },
    ]);
    mocks.persistIdentifiedCandidateBatch.mockResolvedValue(1);
    mocks.markCandidateBatchSaved.mockImplementation(async () => {
      batchStatus = "saved";
      return true;
    });

    const result = await aggregateRefreshWorkflow("job-id", "execution-token");

    expect(result.status).toBe("completed");
    expect(mocks.scoreArticlesById).not.toHaveBeenCalled();
    expect(mocks.persistIdentifiedCandidateBatch).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "ready",
      [
        {
          id: "c1",
          score: { summary: "summary", usefulness: 2, ntt_relevance: 3, reason: "reason" },
        },
      ],
    );
    expect(mocks.persistIdentifiedCandidateBatch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.gcStaleArticles.mock.invocationCallOrder[0]!,
    );
  });

  it("does not finish the job when saving a model result has an ambiguous outcome", async () => {
    mocks.summarizePendingCandidateSignatures
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([{ scoringSignature: "sig", candidateCount: 1, firstOrdinal: 0 }])
      .mockResolvedValueOnce([]);
    mocks.freezeNextCandidateBatch
      .mockResolvedValueOnce({ id: "ambiguous", status: "pending" })
      .mockResolvedValue(null);
    mocks.listCandidateBatches.mockResolvedValue([]);
    mocks.getCandidateBatch.mockResolvedValue({
      id: "ambiguous",
      status: "pending",
      resultJson: null,
    });
    mocks.claimCandidateBatch.mockResolvedValue({
      id: "ambiguous",
      status: "running",
      attemptCount: 1,
    });
    mocks.getBatchCandidates.mockResolvedValue([
      {
        id: "c1",
        payloadJson: JSON.stringify({
          title: "title",
          description: "description",
          preferenceSection: "",
        }),
      },
    ]);
    mocks.scoreArticlesById.mockResolvedValue([
      { id: "c1", score: { summary: "s", usefulness: 2, ntt_relevance: 3, reason: "r" } },
    ]);
    mocks.storeCandidateBatchResult.mockRejectedValue(new Error("database response lost"));
    mocks.getCandidateBatch
      .mockResolvedValueOnce({ id: "ambiguous", status: "pending", resultJson: null })
      .mockResolvedValueOnce({ id: "ambiguous", status: "running", resultJson: null });
    mocks.markCandidateBatchUnknown.mockResolvedValue(true);

    mocks.recoverUnknownCandidateBatch.mockResolvedValue("failed");
    const result = await aggregateRefreshWorkflow("job-id", "execution-token");
    expect(result).toEqual({ status: "partial", failedSources: 1 });
    expect(mocks.markCandidateBatchUnknown).toHaveBeenCalledWith(
      "job-id",
      "execution-token",
      "ambiguous",
      "candidate-result-checkpoint-unknown",
      1,
    );
    expect(mocks.finishRefreshJob).toHaveBeenCalledWith("job-id", "execution-token", "partial");
  });
});
