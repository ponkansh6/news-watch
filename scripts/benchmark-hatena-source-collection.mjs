import { createClient } from "@libsql/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.env.RUN_LIVE_ADAPTER_BENCH !== "1") {
  console.log(
    "No network request was made. Set RUN_LIVE_ADAPTER_BENCH=1 to run one real Hatena collection against an isolated temporary local database.",
  );
  process.exit(0);
}

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = mkdtempSync(join(tmpdir(), "news-watch-hatena-bench-"));
const databasePath = join(tempDirectory, "benchmark.sqlite");
const databaseUrl = `file:${databasePath}`;
const originalDatabaseUrl = process.env.TURSO_DATABASE_URL;
const originalAuthToken = process.env.TURSO_AUTH_TOKEN;
process.env.TURSO_DATABASE_URL = databaseUrl;
delete process.env.TURSO_AUTH_TOKEN;

const capturedMetrics = { source: [], stage: [] };
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
const metricPrefixes = {
  "[aggregate-collection-source-metric]": "source",
  "[aggregate-collection-stage-metric]": "stage",
};
console.info = (...args) => {
  const kind = metricPrefixes[String(args[0])];
  if (!kind || typeof args[1] !== "string") return;
  try {
    capturedMetrics[kind].push(JSON.parse(args[1]));
  } catch {
    // Ignore malformed diagnostic output; never print source payloads.
  }
};
console.warn = () => {};
console.error = () => {};

let migrationClient;
let appDb;
let outcome = "failed";
let collectionResult;
let failureName;
let collectionStartedAt;
let collectionElapsedMs;
const closeQuietly = async (client) => {
  if (!client) return;
  try {
    await client.close();
  } catch {
    // Cleanup should continue even if a local database client has already closed.
  }
};

try {
  migrationClient = createClient({ url: databaseUrl });
  const migrationsDirectory = join(projectRoot, "src/lib/db/migrations");
  const migrations = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    const contents = readFileSync(join(migrationsDirectory, migration), "utf8");
    for (const statement of contents
      .split(/--> statement-breakpoint|;/)
      .map((part) => part.trim())
      .filter(Boolean)) {
      await migrationClient.execute(statement);
    }
  }
  await migrationClient.close();
  migrationClient = undefined;

  const dbModule = await import("../src/lib/db/index.ts");
  appDb = dbModule.db;
  const [jobRepository, schema, drizzleOperators, fetchService] = await Promise.all([
    import("../src/lib/db/repository/refresh-job-repository.ts"),
    import("../src/lib/db/schema.ts"),
    import("drizzle-orm"),
    import("../src/lib/news/fetch-service.ts"),
  ]);
  const { db } = dbModule;

  const started = await jobRepository.startAggregateJob();
  if (started.kind !== "created" || !started.job || !started.executionToken) {
    throw new Error("isolated_job_creation_failed");
  }
  const { job, executionToken } = started;

  // Keep only Hatena in this disposable job snapshot so the normal source
  // ownership checks can claim it without invoking any other adapter.
  await db
    .delete(schema.refreshJobSources)
    .where(
      drizzleOperators.and(
        drizzleOperators.eq(schema.refreshJobSources.jobId, job.id),
        drizzleOperators.ne(schema.refreshJobSources.sourceId, "hatena"),
      ),
    );
  await db
    .update(schema.refreshJobs)
    .set({ status: "running", sourceIds: JSON.stringify(["hatena"]), currentSourceId: "hatena" })
    .where(drizzleOperators.eq(schema.refreshJobs.id, job.id));

  const claim = await jobRepository.claimRefreshSource(job.id, executionToken, "hatena");
  if (!claim) throw new Error("isolated_source_claim_failed");
  collectionStartedAt = performance.now();
  collectionResult = await fetchService.collectRefreshCandidates("hatena", job.id, executionToken, {
    strictAdapterErrors: true,
    sourceAttemptCount: claim.attemptCount,
    beforeAdapterStart: () =>
      jobRepository.canStartRefreshSource(job.id, executionToken, "hatena", claim.attemptCount),
    onAdapterStart: (startedAt) =>
      jobRepository.recordAdapterStart(
        job.id,
        executionToken,
        "hatena",
        claim.attemptCount,
        startedAt,
      ),
  });
  outcome = "saved";
} catch (error) {
  failureName = error instanceof Error ? error.name : "UnknownError";
} finally {
  if (collectionStartedAt !== undefined) {
    collectionElapsedMs = Number((performance.now() - collectionStartedAt).toFixed(2));
  }
  try {
    await closeQuietly(migrationClient);
    await closeQuietly(appDb?.$client);
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    rmSync(tempDirectory, { recursive: true, force: true });
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = originalDatabaseUrl;
    if (originalAuthToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = originalAuthToken;
  }
}

const sourceMetricFields = [
  "outcome",
  "failedStage",
  "profileSignatureMs",
  "checkpointMs",
  "adapterMs",
  "adapterRequestElapsedMs",
  "rawCount",
  "normalizeDeduplicateMs",
  "normalizedCount",
  "selectionMs",
  "selectedCount",
  "deferredCount",
  "stageMs",
  "elapsedMs",
];
const stageMetricFields = [
  "sourceAttemptCount",
  "candidateCount",
  "existingCandidateCount",
  "inserted",
  "merged",
  "existingCandidateReads",
  "maxOrdinalReads",
  "outcome",
  "durationMs",
];
const safeMetric = (metric, fields) =>
  Object.fromEntries(fields.filter((key) => key in metric).map((key) => [key, metric[key]]));

console.log(
  JSON.stringify(
    {
      benchmark: "aggregate-source-collection-live-adapter",
      sourceId: "hatena",
      attempts: 1,
      databaseTransport: "temporary-local-file-libsql",
      outcome,
      failureName,
      collectionElapsedMs: collectionElapsedMs ?? null,
      fetched: collectionResult?.fetched ?? null,
      selected: collectionResult?.selected ?? null,
      deferred: collectionResult?.deferred ?? null,
      sourceMetricCount: capturedMetrics.source.length,
      sourceMetrics: capturedMetrics.source.map((metric) => safeMetric(metric, sourceMetricFields)),
      stageMetricCount: capturedMetrics.stage.length,
      stageMetrics: capturedMetrics.stage.map((metric) => safeMetric(metric, stageMetricFields)),
      caveat:
        "One live Hatena adapter attempt with a temporary local database; this is source-level collection timing, not remote Turso latency or a multi-source Workflow total. URLs, article payloads, profile values, raw responses, and database credentials are omitted.",
    },
    null,
    2,
  ),
);

if (outcome !== "saved") process.exitCode = 1;
