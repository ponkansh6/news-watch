import { createClient } from "@libsql/client";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Controlled local libSQL comparison for shared-plan 30. The legacy and Map
// variants run the same SQL fixture, one source transaction at a time.
const REPEATS = Number(process.env.BENCH_REPEATS ?? 15);
const WARMUPS = Math.max(1, Math.min(5, Math.ceil(REPEATS / 3)));
const SOURCE_IDS = [
  "zenn",
  "qiita",
  "yamadashy",
  "itmedia",
  "codezine",
  "zdnet",
  "xtech",
  "cloudwatch",
  "hatena",
];
const benchmarkDirectory = mkdtempSync(join(tmpdir(), "shared-plan30-benchmark-"));
const databaseUrl = `file:${join(benchmarkDirectory, "benchmark.db")}`;
const FIXTURES = [
  { candidatesPerSource: 0, sharedRatio: 0 },
  { candidatesPerSource: 1, sharedRatio: 0 },
  { candidatesPerSource: 50, sharedRatio: 0 },
  { candidatesPerSource: 50, sharedRatio: 0.5 },
  { candidatesPerSource: 50, sharedRatio: 1 },
];
const client = createClient({ url: databaseUrl, concurrency: 1 });

function databaseTransport(url) {
  if (url === ":memory:") return "in-memory-libsql";
  if (/^file:/i.test(url)) return "local-file-libsql";
  if (/^https?:/i.test(url) || /^libsqls?:/i.test(url)) return "remote-libsql";
  return "configured-libsql";
}

function jsonBytes(value) {
  return Buffer.byteLength(
    JSON.stringify(value, (_, item) => (typeof item === "bigint" ? String(item) : item)),
  );
}

async function reset() {
  await client.execute("DROP TABLE IF EXISTS candidates");
  await client.execute(`CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    normalized_url TEXT NOT NULL UNIQUE,
    source_ids_json TEXT NOT NULL,
    representative_source_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    scoring_signature TEXT NOT NULL
  )`);
}

function sourceInputs(sharedRatio, candidatesPerSource) {
  return SOURCE_IDS.map((sourceId, sourceIndex) =>
    Array.from({ length: candidatesPerSource }, (_, index) => {
      const isShared = sourceIndex > 0 && index < candidatesPerSource * sharedRatio;
      const urlIndex =
        sourceIndex === 0 || isShared ? 100_000 + index : 200_000 + sourceIndex * 50 + index;
      return {
        id: `${sourceId}-${index}`,
        normalizedUrl: `https://example.test/article/${urlIndex}`,
        sourceId,
        contentHash: `hash-${sourceId}-${index}`,
        scoringSignature: `signature-${sourceId}`,
        payloadJson: JSON.stringify({
          title: `Fixture article ${sourceId} ${index}`,
          url: `https://example.test/article/${urlIndex}`,
        }),
      };
    }),
  );
}

async function runSource(inputs, mode, counters) {
  const tx = await client.transaction("write");
  const execute = async (statement, args = []) => {
    counters.statements++;
    const result = await tx.execute({ sql: statement, args });
    const kind = /^\s*SELECT\b/i.test(statement) ? "select" : "write";
    if (kind === "select") counters.selectStatements++;
    counters[`${kind}Rows`] += result.rows.length;
    counters[`${kind}Bytes`] += jsonBytes(result.rows);
    if (/SELECT\s+(?:id|\*)\s+FROM\s+candidates\s+WHERE\s+normalized_url/i.test(statement))
      counters.perCandidateLookupSelects++;
    if (
      /SELECT\s+id,\s*normalized_url,\s*source_ids_json,\s*representative_source_id,\s*ordinal\s+FROM\s+candidates\s*$/i.test(
        statement,
      )
    )
      counters.candidateSnapshotSelects++;
    if (/SELECT\s+COALESCE\(MAX\(ordinal\)/i.test(statement)) counters.maxOrdinalSelects++;
    return result.rows;
  };

  try {
    let nextOrdinal = 0;
    let candidatesByUrl;
    if (mode === "map") {
      const existingRows = await execute(
        "SELECT id, normalized_url, source_ids_json, representative_source_id, ordinal FROM candidates",
      );
      const [{ max_ordinal: maxOrdinal }] = await execute(
        "SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal FROM candidates",
      );
      nextOrdinal = Number(maxOrdinal) + 1;
      candidatesByUrl = new Map(existingRows.map((row) => [row.normalized_url, row]));
    }

    for (const input of inputs) {
      let row;
      if (mode === "legacy") {
        [row] = await execute("SELECT * FROM candidates WHERE normalized_url = ?", [
          input.normalizedUrl,
        ]);
      } else {
        row = candidatesByUrl.get(input.normalizedUrl);
      }

      if (row) {
        const sourceIds = JSON.parse(row.source_ids_json);
        if (!sourceIds.includes(input.sourceId)) sourceIds.push(input.sourceId);
        const isHigherPriority =
          SOURCE_IDS.indexOf(input.sourceId) < SOURCE_IDS.indexOf(row.representative_source_id);
        if (isHigherPriority) {
          await execute(
            "UPDATE candidates SET source_ids_json = ?, representative_source_id = ?, payload_json = ?, content_hash = ?, scoring_signature = ? WHERE id = ?",
            [
              JSON.stringify(sourceIds),
              input.sourceId,
              input.payloadJson,
              input.contentHash,
              input.scoringSignature,
              row.id,
            ],
          );
        } else {
          await execute("UPDATE candidates SET source_ids_json = ? WHERE id = ?", [
            JSON.stringify(sourceIds),
            row.id,
          ]);
        }
        if (mode === "map") {
          candidatesByUrl.set(input.normalizedUrl, {
            ...row,
            source_ids_json: JSON.stringify(sourceIds),
            ...(isHigherPriority ? { representative_source_id: input.sourceId } : {}),
          });
        }
      } else {
        if (mode === "legacy") {
          const [{ max_ordinal: maxOrdinal }] = await execute(
            "SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal FROM candidates",
          );
          nextOrdinal = Number(maxOrdinal) + 1;
        }
        const rowToInsert = {
          id: input.id,
          normalized_url: input.normalizedUrl,
          source_ids_json: JSON.stringify([input.sourceId]),
          representative_source_id: input.sourceId,
          ordinal: nextOrdinal++,
          payload_json: input.payloadJson,
          content_hash: input.contentHash,
          scoring_signature: input.scoringSignature,
        };
        await execute(
          "INSERT INTO candidates (id, normalized_url, source_ids_json, representative_source_id, ordinal, payload_json, content_hash, scoring_signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            rowToInsert.id,
            rowToInsert.normalized_url,
            rowToInsert.source_ids_json,
            rowToInsert.representative_source_id,
            rowToInsert.ordinal,
            rowToInsert.payload_json,
            rowToInsert.content_hash,
            rowToInsert.scoring_signature,
          ],
        );
        if (mode === "map") {
          candidatesByUrl.set(input.normalizedUrl, {
            id: rowToInsert.id,
            normalized_url: rowToInsert.normalized_url,
            source_ids_json: rowToInsert.source_ids_json,
            representative_source_id: rowToInsert.representative_source_id,
            ordinal: rowToInsert.ordinal,
            content_hash: rowToInsert.content_hash,
            scoring_signature: rowToInsert.scoring_signature,
          });
        }
      }
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples, mapHeapDeltas = []) {
  const elapsed = samples.map((sample) => sample.elapsedMs);
  return {
    repeats: samples.length,
    p50Ms: Number(percentile(elapsed, 0.5).toFixed(3)),
    p95Ms: Number(percentile(elapsed, 0.95).toFixed(3)),
    statements: samples[0].counters.statements,
    selectStatements: samples[0].counters.selectStatements,
    perCandidateLookupSelects: samples[0].counters.perCandidateLookupSelects,
    maxOrdinalSelects: samples[0].counters.maxOrdinalSelects,
    selectRows: samples[0].counters.selectRows,
    selectBytes: samples[0].counters.selectBytes,
    writeRows: samples[0].counters.writeRows,
    writeBytes: samples[0].counters.writeBytes,
    maxPerSourceMapConstructionHeapDeltaBytesP50: mapHeapDeltas.length
      ? percentile(mapHeapDeltas, 0.5)
      : null,
  };
}

async function measureFinalSourceMapHeapDelta(fixture) {
  if (!globalThis.gc) return null;
  await reset();
  const counters = {
    statements: 0,
    selectStatements: 0,
    perCandidateLookupSelects: 0,
    candidateSnapshotSelects: 0,
    maxOrdinalSelects: 0,
    selectRows: 0,
    selectBytes: 0,
    writeRows: 0,
    writeBytes: 0,
  };
  const sources = sourceInputs(fixture.sharedRatio, fixture.candidatesPerSource);
  for (const inputs of sources.slice(0, -1)) await runSource(inputs, "map", counters);
  const { rows } = await client.execute(
    "SELECT id, normalized_url, source_ids_json, representative_source_id, ordinal FROM candidates",
  );
  globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const candidatesByUrl = new Map(rows.map((row) => [row.normalized_url, row]));
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  if (candidatesByUrl.size !== rows.length)
    throw new Error("Map memory fixture lost candidate rows");
  return heapDeltaBytes;
}

try {
  const report = {
    benchmark: "aggregate-candidate-staging-local-libsql",
    generatedAt: new Date().toISOString(),
    databaseTransport: databaseTransport(databaseUrl),
    repeatCountPerMode: REPEATS,
    warmupPairs: WARMUPS,
    fixture:
      "9 registry-ordered sources; 0/1/50 candidates/source; 0%, 50%, or 100% URL overlap for the 50-candidate case",
    caveat:
      "Legacy and Map modes are repository-shaped SQL implementations on the same local libSQL transport, with paired warmups, alternating measured order, and no forced GC or heap sampling inside the latency interval; elapsed values are not Turso network latency or Workflow end-to-end source collection. Map construction heap deltas are measured in separate runs after preceding sources have staged, with GC before each sample; the reported median is for the final source, which has the largest candidate Map in these fixtures. This is an approximate Map allocation delta, not total retained row memory or peak process memory. Memory sampling is available only with node --expose-gc.",
    results: [],
  };

  for (const fixture of FIXTURES) {
    const modes = { legacy: [], map: [] };
    const finalStates = {};
    const runMode = async (mode) => {
      await reset();
      const sources = sourceInputs(fixture.sharedRatio, fixture.candidatesPerSource);
      const counters = {
        statements: 0,
        selectStatements: 0,
        perCandidateLookupSelects: 0,
        candidateSnapshotSelects: 0,
        maxOrdinalSelects: 0,
        selectRows: 0,
        selectBytes: 0,
        writeRows: 0,
        writeBytes: 0,
      };
      const startedAt = performance.now();
      for (const inputs of sources) {
        await runSource(inputs, mode, counters);
      }
      const elapsedMs = performance.now() - startedAt;
      modes[mode].push({ elapsedMs, counters });
      const finalRows = await client.execute("SELECT * FROM candidates ORDER BY ordinal");
      finalStates[mode] = finalRows.rows;
    };

    for (let warmup = 0; warmup < WARMUPS; warmup++) {
      const order = warmup % 2 === 0 ? ["legacy", "map"] : ["map", "legacy"];
      for (const mode of order) await runMode(mode);
    }

    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const order = repeat % 2 === 0 ? ["legacy", "map"] : ["map", "legacy"];
      for (const mode of order) await runMode(mode);
    }
    deepStrictEqual(finalStates.map, finalStates.legacy);
    const mapHeapDeltas = [];
    if (globalThis.gc) {
      for (let repeat = 0; repeat < REPEATS; repeat++)
        mapHeapDeltas.push(await measureFinalSourceMapHeapDelta(fixture));
    }
    const legacyCounters = modes.legacy[0].counters;
    const mapCounters = modes.map[0].counters;
    for (const mode of ["legacy", "map"])
      report.results.push({
        sharedUrlRatio: fixture.sharedRatio,
        sources: SOURCE_IDS.length,
        candidatesPerSource: fixture.candidatesPerSource,
        mode,
        comparison: {
          legacyCandidateLookupSelects: legacyCounters.perCandidateLookupSelects,
          legacyMaxOrdinalSelects: legacyCounters.maxOrdinalSelects,
          legacyCandidateAndOrdinalSelects:
            legacyCounters.perCandidateLookupSelects + legacyCounters.maxOrdinalSelects,
          mapExistingCandidateSnapshotSelects: mapCounters.candidateSnapshotSelects,
          mapMaxOrdinalSelects: mapCounters.maxOrdinalSelects,
          mapCandidateAndOrdinalSelects:
            mapCounters.candidateSnapshotSelects + mapCounters.maxOrdinalSelects,
          legacyAllSelectStatements: legacyCounters.selectStatements,
          mapAllSelectStatements: mapCounters.selectStatements,
        },
        equivalence: "legacy and Map persisted rows match",
        ...summarize(modes[mode], mode === "map" ? mapHeapDeltas : []),
      });
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  rmSync(benchmarkDirectory, { recursive: true, force: true });
}
