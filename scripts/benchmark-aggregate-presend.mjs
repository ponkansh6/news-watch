import { createClient } from "@libsql/client";
import { performance } from "node:perf_hooks";

// Local SQLite proxy benchmark for shared-plan 29. This deliberately measures
// repository-shaped work only; it does not measure Turso RTT or Gemini HTTP.
const REPEATS = Number(process.env.BENCH_REPEATS ?? 15);
const SIZES = [50, 250, 1000];
const PAYLOAD = JSON.stringify({
  title: "Representative benchmark article title",
  description: "A fixed description used to compare row bytes consistently.",
  url: "https://example.test/article/000000",
  publishedAt: "2026-01-01T00:00:00.000Z",
});
const client = createClient({ url: ":memory:", concurrency: 1 });

function candidateRows(size) {
  return Array.from({ length: size }, (_, i) => ({
    id: `candidate-${i}`,
    jobId: "job-benchmark",
    signature: `signature-${i % 4}`,
    ordinal: i,
    status: "pending",
    payload: PAYLOAD.replace("000000", String(i).padStart(6, "0")),
  }));
}

async function reset(size) {
  // Keep schema creation and fixture reset on the same client, in order. This
  // makes reset safe as the first operation and after any previous benchmark
  // transaction, without relying on top-level initialization ordering.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      candidate_ids_json TEXT NOT NULL,
      scoring_signature TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      scoring_signature TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      batch_id TEXT
    )
  `);
  await client.execute("DELETE FROM batches");
  await client.execute("DELETE FROM candidates");
  const rows = candidateRows(size);
  await client.batch(
    rows.map((row) => ({
      sql: "INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, NULL)",
      args: [row.id, row.jobId, row.signature, row.ordinal, row.status, row.payload],
    })),
    "write",
  );
  return rows;
}

async function measureP1(size, mode) {
  const counters = {
    statements: 0,
    resultRows: 0,
    resultBytes: 0,
    returningRows: 0,
    returningBytes: 0,
  };
  const query = async (sql, args = []) => {
    counters.statements++;
    const result = await client.execute({ sql, args });
    counters.resultRows += result.rows.length;
    counters.resultBytes += Buffer.byteLength(JSON.stringify(result.rows));
    return result.rows;
  };
  const start = performance.now();
  if (mode === "old") {
    const rows = await query(
      "SELECT scoring_signature, ordinal, payload_json FROM candidates WHERE job_id = ? AND status = 'pending' ORDER BY ordinal",
      ["job-benchmark"],
    );
    const groups = new Map();
    for (const row of rows) {
      const key = row.scoring_signature;
      const group = groups.get(key) ?? { count: 0, firstOrdinal: Number(row.ordinal) };
      group.count++;
      groups.set(key, group);
    }
    void groups;
  } else {
    await query(
      "SELECT scoring_signature, COUNT(*) AS candidate_count, MIN(ordinal) AS first_ordinal FROM candidates WHERE job_id = ? AND status = 'pending' GROUP BY scoring_signature ORDER BY MIN(ordinal)",
      ["job-benchmark"],
    );
  }
  return { elapsedMs: performance.now() - start, ...counters };
}

async function measureP2(size, mode) {
  await reset(size);
  const counters = {
    statements: 0,
    resultRows: 0,
    resultBytes: 0,
    returningRows: 0,
    returningBytes: 0,
  };
  const tx = await client.transaction("write");
  const execute = async (sql, args = [], resultKind = "query") => {
    counters.statements++;
    const result = await tx.execute({ sql, args });
    const rowCountKey = resultKind === "returning" ? "returningRows" : "resultRows";
    const bytesKey = resultKind === "returning" ? "returningBytes" : "resultBytes";
    counters[rowCountKey] += result.rows.length;
    counters[bytesKey] += Buffer.byteLength(JSON.stringify(result.rows));
    return result.rows;
  };
  const start = performance.now();
  try {
    let batchOrdinal = 0;
    for (const signatureIndex of [0, 1, 2, 3]) {
      const signature = `signature-${signatureIndex}`;
      while (true) {
        const selected = await execute(
          "SELECT id, ordinal FROM candidates WHERE job_id = ? AND scoring_signature = ? AND status = 'pending' ORDER BY ordinal LIMIT 50",
          ["job-benchmark", signature],
        );
        if (selected.length === 0) break;
        const ids = selected.map((row) => row.id);
        const [maxOrdinal] = await execute(
          "SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM batches WHERE job_id = ?",
          ["job-benchmark"],
        );
        batchOrdinal = Number(maxOrdinal.ordinal) + 1;
        const batchId = `batch-${batchOrdinal}`;
        await execute("INSERT INTO batches VALUES (?, ?, ?, ?, ?)", [
          batchId,
          "job-benchmark",
          batchOrdinal,
          JSON.stringify(ids),
          signature,
        ]);
        if (mode === "old") {
          for (const id of ids) {
            await execute(
              "UPDATE candidates SET status = 'batched', batch_id = ? WHERE id = ? AND job_id = ? AND scoring_signature = ? AND status = 'pending'",
              [batchId, id, "job-benchmark", signature],
            );
          }
        } else {
          const placeholders = ids.map(() => "?").join(",");
          await execute(
            `UPDATE candidates SET status = 'batched', batch_id = ? WHERE id IN (${placeholders}) AND job_id = ? AND scoring_signature = ? AND status = 'pending' RETURNING id`,
            [batchId, ...ids, "job-benchmark", signature],
            "returning",
          );
        }
      }
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
  return { elapsedMs: performance.now() - start, ...counters };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples) {
  return {
    p50Ms: Number(
      percentile(
        samples.map((sample) => sample.elapsedMs),
        0.5,
      ).toFixed(3),
    ),
    p95Ms: Number(
      percentile(
        samples.map((sample) => sample.elapsedMs),
        0.95,
      ).toFixed(3),
    ),
    statements: samples[0].statements,
    resultRows: samples[0].resultRows,
    resultBytes: samples[0].resultBytes,
    returningRows: samples[0].returningRows,
    returningBytes: samples[0].returningBytes,
    repeats: samples.length,
  };
}

const report = {
  benchmark: "aggregate-presend-local-sqlite",
  generatedAt: new Date().toISOString(),
  repeatCount: REPEATS,
  fixture:
    "4 signatures ordered by first ordinal; deterministic payloads; local :memory: SQLite; warm database",
  caveat:
    "Local proxy only. It does not measure Turso transport round trips, workflow scheduling, Gemini SDK preparation, or HTTP request start.",
  results: [],
};

for (const size of SIZES) {
  await reset(size);
  const p1Samples = { old: [], new: [] };
  for (let run = 0; run < REPEATS * 2; run++) {
    const mode = run % 2 === 0 ? "old" : "new";
    p1Samples[mode].push(await measureP1(size, mode));
  }
  for (const mode of ["old", "new"])
    report.results.push({
      phase: "P1-signature-summary",
      size,
      mode,
      ...summarize(p1Samples[mode]),
    });

  const p2Samples = { old: [], new: [] };
  for (let run = 0; run < REPEATS * 2; run++) {
    const mode = run % 2 === 0 ? "old" : "new";
    p2Samples[mode].push(await measureP2(size, mode));
  }
  for (const mode of ["old", "new"])
    report.results.push({
      phase: "P2-freeze-membership-update",
      size,
      mode,
      ...summarize(p2Samples[mode]),
    });
}

console.log(JSON.stringify(report, null, 2));
await client.close();
