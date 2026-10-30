import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, refreshJobSlot, refreshJobs } from "@/lib/db/schema";
import {
  getOwnedRefreshJob,
  getRefreshJobSources,
  startAggregateJob,
} from "@/lib/db/repository/refresh-job-repository";
import { listRefreshJobCandidates } from "@/lib/db/repository/refresh-candidate-repository";
import { SOURCE_IDS, SOURCE_REGISTRY, type SourceId } from "@/lib/news/registry";
import type { NormalizedArticle } from "@/lib/types";
import { aggregateRefreshWorkflow } from "@/workflows/aggregate-refresh";

const mockState = vi.hoisted(() => ({
  workflowRunId: 0,
  scoreArticlesById: vi.fn(),
}));

vi.mock("workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workflow")>();
  return {
    ...actual,
    getWorkflowMetadata: () => ({
      workflowRunId: `collection-benchmark-${++mockState.workflowRunId}`,
    }),
  };
});

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, scoreArticlesById: mockState.scoreArticlesById };
});

type FixtureItem = { index: number; url: string };
type FixtureOverlap = "none" | "half" | "all";
type FixtureMode = { candidatesPerSource: number; overlap: FixtureOverlap };
type MetricEvent = Record<string, unknown>;
type AdapterShape = {
  fetch: (limit?: number) => Promise<unknown[]>;
  fetchForWorkflow: (limit?: number) => Promise<unknown[]>;
  toArticle: (item: unknown, sourceId: string) => NormalizedArticle;
  name: string;
};

const workflowMetricPrefix = "[aggregate-collection-workflow-metric]";
const sourceMetricPrefix = "[aggregate-collection-source-metric]";
const stageMetricPrefix = "[aggregate-collection-stage-metric]";
const fixtureUrlPrefix = "https://benchmark.invalid/";
const benchmarkEnabled = process.env.RUN_WORKFLOW_COLLECTION_BENCH === "1";
const createdJobIds: string[] = [];
const originalAdapters = new Map<
  SourceId,
  Pick<AdapterShape, "fetch" | "fetchForWorkflow" | "toArticle">
>();

let activeFixture: FixtureMode = { candidatesPerSource: 0, overlap: "none" };
let adapterCallOrder: SourceId[] = [];
let observedMetrics: { workflow: MetricEvent[]; source: MetricEvent[]; stage: MetricEvent[] } = {
  workflow: [],
  source: [],
  stage: [],
};

function fixtureUrl(sourceId: SourceId, index: number, mode: FixtureMode): string {
  if (mode.overlap === "all") return `${fixtureUrlPrefix}shared/${index}`;
  if (mode.overlap === "half" && index < Math.ceil(mode.candidatesPerSource / 2)) {
    return `${fixtureUrlPrefix}shared/${index}`;
  }
  return `${fixtureUrlPrefix}${sourceId}/${index}`;
}

function fixtureItems(sourceId: SourceId, mode: FixtureMode): FixtureItem[] {
  return Array.from({ length: mode.candidatesPerSource }, (_, index) => ({
    index,
    url: fixtureUrl(sourceId, index, mode),
  }));
}

function expectedUniqueCount(mode: FixtureMode): number {
  if (mode.candidatesPerSource === 0) return 0;
  if (mode.overlap === "all") return mode.candidatesPerSource;
  if (mode.overlap === "half") {
    const shared = Math.ceil(mode.candidatesPerSource / 2);
    return shared + (mode.candidatesPerSource - shared) * SOURCE_IDS.length;
  }
  return mode.candidatesPerSource * SOURCE_IDS.length;
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[index]!.toFixed(2));
}

function p50(values: number[]): number {
  return percentile(values, 50);
}

function p95(values: number[]): number {
  return percentile(values, 95);
}

async function clearFixtureArticles(): Promise<void> {
  await db.delete(articles).where(like(articles.url, `${fixtureUrlPrefix}%`));
}

async function runWorkflowSample(mode: FixtureMode): Promise<number> {
  activeFixture = mode;
  adapterCallOrder = [];
  observedMetrics = { workflow: [], source: [], stage: [] };

  const started = await startAggregateJob();
  if (started.kind !== "created" || !started.job || !started.executionToken) {
    throw new Error("collection_benchmark_job_creation_failed");
  }
  const { job, executionToken } = started;
  createdJobIds.push(job.id);

  const result = await aggregateRefreshWorkflow(job.id, executionToken);
  expect(result).toEqual({ status: "completed", failedSources: 0 });
  expect(adapterCallOrder).toEqual(SOURCE_IDS);
  expect(observedMetrics.workflow).toHaveLength(1);
  expect(observedMetrics.source).toHaveLength(SOURCE_IDS.length);
  expect(observedMetrics.stage).toHaveLength(SOURCE_IDS.length);

  const workflowMetric = observedMetrics.workflow[0]!;
  expect(workflowMetric).toMatchObject({
    sourceCount: SOURCE_IDS.length,
    outcome: "completed",
  });
  expect(typeof workflowMetric.collectionElapsedMs).toBe("number");
  const elapsedMs = Number(workflowMetric.collectionElapsedMs);
  expect(Number.isFinite(elapsedMs)).toBe(true);

  const persistedJob = await getOwnedRefreshJob(job.id);
  expect(persistedJob?.status).toBe("completed");
  const sources = await getRefreshJobSources(job.id);
  expect(sources.map((source) => source.sourceId)).toEqual(SOURCE_IDS);
  expect(
    sources.every(
      (source) =>
        source.status === "invalidated" &&
        source.attemptCount === 1 &&
        source.adapterStartedAt !== null &&
        source.resultCount === mode.candidatesPerSource,
    ),
  ).toBe(true);

  const slotRows = await db.select().from(refreshJobSlot).where(eq(refreshJobSlot.id, 1));
  expect(slotRows[0]?.ownerId ?? null).toBeNull();

  const candidates = await listRefreshJobCandidates(job.id, executionToken);
  expect(candidates).toHaveLength(expectedUniqueCount(mode));
  expect(candidates.every((candidate) => candidate.status === "saved")).toBe(true);
  expect(candidates.map((candidate) => candidate.ordinal)).toEqual(
    Array.from({ length: candidates.length }, (_, index) => index),
  );
  for (const candidate of candidates) {
    const sourceIds = JSON.parse(candidate.sourceIdsJson) as SourceId[];
    expect(sourceIds).toEqual(SOURCE_IDS.filter((sourceId) => sourceIds.includes(sourceId)));
    expect(candidate.representativeSourceId).toBe(sourceIds[0]);
  }

  return elapsedMs;
}

async function cleanupMeasurementData(): Promise<void> {
  await clearFixtureArticles();
  if (createdJobIds.length > 0) {
    await db.delete(refreshJobs).where(inArray(refreshJobs.id, createdJobIds));
    createdJobIds.length = 0;
  }
  await db
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
    .where(and(eq(refreshJobSlot.id, 1), eq(refreshJobSlot.ownerKind, "job")));
}

describe("aggregate refresh local multi-source collection measurement", () => {
  beforeAll(() => {
    mockState.scoreArticlesById.mockImplementation(async (candidates: Array<{ id: string }>) =>
      candidates.map(({ id }) => ({
        id,
        score: {
          summary: "fixture summary",
          usefulness: 2,
          ntt_relevance: 2,
          reason: "fixture score",
        },
      })),
    );
    for (const sourceId of SOURCE_IDS) {
      const adapter = SOURCE_REGISTRY[sourceId] as unknown as AdapterShape;
      originalAdapters.set(sourceId, {
        fetch: adapter.fetch,
        fetchForWorkflow: adapter.fetchForWorkflow,
        toArticle: adapter.toArticle,
      });
      adapter.fetch = async () => {
        throw new Error("unexpected_unstrict_adapter_fetch");
      };
      adapter.fetchForWorkflow = async () => {
        adapterCallOrder.push(sourceId);
        return fixtureItems(sourceId, activeFixture);
      };
      adapter.toArticle = (raw, selectedSource) => {
        const item = raw as FixtureItem;
        return {
          title: `Fixture article ${item.url}`,
          description: `Fixture description ${item.url}`,
          url: item.url,
          urlToImage: null,
          publishedAt: "2026-01-02T00:00:00.000Z",
          sourceName: SOURCE_REGISTRY[selectedSource as SourceId].name,
          sourceId: selectedSource,
          author: null,
        };
      };
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("unexpected_external_fetch"))),
    );
    vi.spyOn(console, "info").mockImplementation((...args) => {
      const prefix = String(args[0]);
      const target =
        prefix === workflowMetricPrefix
          ? observedMetrics.workflow
          : prefix === sourceMetricPrefix
            ? observedMetrics.source
            : prefix === stageMetricPrefix
              ? observedMetrics.stage
              : undefined;
      if (!target || typeof args[1] !== "string") return;
      try {
        target.push(JSON.parse(args[1]) as MetricEvent);
      } catch {
        // Ignore non-JSON diagnostic messages; measured output stays privacy-safe.
      }
    });
  });

  afterEach(async () => {
    await cleanupMeasurementData();
  });

  afterAll(() => {
    for (const [sourceId, original] of originalAdapters) {
      const adapter = SOURCE_REGISTRY[sourceId] as unknown as AdapterShape;
      adapter.fetch = original.fetch;
      adapter.fetchForWorkflow = original.fetchForWorkflow;
      adapter.toArticle = original.toArticle;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.skipIf(!benchmarkEnabled)(
    "measures nine-source collection p50/p95 through the actual local workflow path",
    async () => {
      const modes: FixtureMode[] = [
        { candidatesPerSource: 0, overlap: "none" },
        { candidatesPerSource: 1, overlap: "none" },
        { candidatesPerSource: 50, overlap: "none" },
        { candidatesPerSource: 50, overlap: "half" },
        { candidatesPerSource: 50, overlap: "all" },
      ];
      const report: Array<Record<string, unknown>> = [];
      for (const mode of modes) {
        await runWorkflowSample(mode); // Warmup is excluded from percentile samples.
        await cleanupMeasurementData();
      }

      const samplesByMode = modes.map((): number[] => []);
      for (let round = 0; round < 15; round++) {
        const offset = round % modes.length;
        for (let position = 0; position < modes.length; position++) {
          const modeIndex = (offset + position) % modes.length;
          samplesByMode[modeIndex]!.push(await runWorkflowSample(modes[modeIndex]!));
          await cleanupMeasurementData();
        }
      }

      for (const [modeIndex, mode] of modes.entries()) {
        const samples = samplesByMode[modeIndex]!;
        report.push({
          fixtureCandidatesPerSource: mode.candidatesPerSource,
          sourceCount: SOURCE_IDS.length,
          overlap: mode.overlap,
          uniqueCandidateCount: expectedUniqueCount(mode),
          warmups: 1,
          repeats: samples.length,
          p50CollectionElapsedMs: p50(samples),
          p95CollectionElapsedMs: p95(samples),
        });
      }

      console.log(
        JSON.stringify(
          {
            benchmark: "local-direct-workflow-multi-source-collection",
            databaseTransport: "isolated-vitest-file-libsql",
            collectionMeasurement: "aggregate-collection-workflow-metric.collectionElapsedMs",
            adapterMode: "deterministic fixture; external fetch prohibited",
            scoringMode: "deterministic local stub; excluded from collection interval",
            report,
            caveat:
              "Direct invocation of the real workflow function with real local repositories and collection steps; it does not measure durable runtime dispatch/replay, remote adapters, or remote Turso. No legacy full-workflow baseline is available.",
          },
          null,
          2,
        ),
      );
    },
    180_000,
  );
});
