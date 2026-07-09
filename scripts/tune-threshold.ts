/**
 * Threshold tuning harness for the hybrid vector pre-filter.
 *
 * Sweeps SIMILARITY_THRESHOLD candidates over a labeled dataset and reports
 * precision / recall / F1 so the optimal threshold can be chosen without
 * guessing.
 *
 * Offline mode (default in sandbox) uses a deterministic bag-of-words hash
 * embedding so no API key is required. For production tuning, run without
 * --offline to use real Google embeddings (requires GOOGLE_API_KEY).
 *
 * Usage:
 *   pnpm tune                         # offline, default dataset + range
 *   pnpm tune --offline --min 0.6 --max 0.9 --step 0.02
 *   pnpm tune --dataset path/to.json  # real embeddings
 *   pnpm tune --write-env --policy recall-first  # real tuning + write to .env.local
 *   pnpm tune --offline --write-env --dry-run  # preview changes without writing
 *   pnpm tune --offline --json  # machine-readable output for CI
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateThreshold,
  sweepThresholds,
  recommendThreshold,
  type LabeledSample,
  type ScoredArticle,
  type ThresholdResult,
  type ThresholdRecommendation,
} from "../src/lib/threshold-eval";
import {
  type ThresholdPolicy,
  renderThresholdEntry,
  selectThreshold,
  upsertEnvVar,
} from "../src/lib/threshold-apply";

interface Args {
  offline: boolean;
  dataset: string;
  min: number;
  max: number;
  step: number;
  policy: ThresholdPolicy;
  writeEnv: boolean;
  envFile: string;
  dryRun: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    offline: false,
    dataset: resolve(process.cwd(), "scripts/fixtures/threshold-dataset.json"),
    min: 0.5,
    max: 0.95,
    step: 0.05,
    policy: "balanced",
    writeEnv: false,
    envFile: ".env.local",
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") args.offline = true;
    else if (a === "--dataset") args.dataset = resolve(process.cwd(), argv[++i] ?? args.dataset);
    else if (a === "--min") args.min = Number(argv[++i]);
    else if (a === "--max") args.max = Number(argv[++i]);
    else if (a === "--step") args.step = Number(argv[++i]);
    else if (a === "--policy") args.policy = argv[++i] as ThresholdPolicy;
    else if (a === "--write-env" || a === "--apply") args.writeEnv = true;
    else if (a === "--env-file") args.envFile = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
  }
  return args;
}

function buildThresholds(min: number, max: number, step: number): number[] {
  const thresholds: number[] = [];
  // Avoid floating point drift by rounding to 4 decimals.
  for (let t = min; t <= max + 1e-9; t += step) {
    thresholds.push(Math.round(t * 10000) / 10000);
  }
  return thresholds;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Offline lexical proxy: fraction of query tokens present in the document.
 * Used instead of cosine in --offline mode because bag-of-words cosine
 * dilutes a short query against a long document, making the threshold sweep
 * meaningless. This gives a clean [0,1] signal for logic validation; real
 * tuning must use --real-embeddings (cosine on Google vectors).
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

function lexicalSimilarity(query: string, doc: string): number {
  const q = tokenize(query);
  const d = new Set(tokenize(doc));
  if (q.length === 0) return 0;
  const hits = q.filter((t) => d.has(t)).length;
  return hits / q.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = buildThresholds(args.min, args.max, args.step);

  const raw = readFileSync(args.dataset, "utf-8");
  const samples: LabeledSample[] = JSON.parse(raw);

  // Check for real embeddings API key if not offline
  if (!args.offline && !process.env.GOOGLE_API_KEY) {
    console.error(
      "GOOGLE_API_KEY が未設定です。実embeddingsチューニングにはキーが必要です（オフライン検証は --offline を指定）",
    );
    process.exit(1);
  }

  // Lazily import real embeddings only when needed (keeps offline runs key-free).
  let embedQuery: ((q: string) => Promise<number[]>) | null = null;
  let embedArticle: ((t: string, d: string | null) => Promise<number[]>) | null = null;
  if (!args.offline) {
    const mod = await import("../src/lib/embeddings");
    embedQuery = mod.embedQuery;
    embedArticle = mod.embedArticle;
  }

  const scored: ScoredArticle[] = [];

  for (const sample of samples) {
    if (args.offline) {
      for (const article of sample.articles) {
        const similarity = lexicalSimilarity(
          sample.keyword,
          `${article.title} ${article.description ?? ""}`,
        );
        scored.push({ similarity, relevant: article.relevant });
      }
    } else {
      const queryVec = await embedQuery!(sample.keyword);
      for (const article of sample.articles) {
        const docVec = await embedArticle!(article.title, article.description);
        const similarity = cosineSimilarity(queryVec, docVec);
        scored.push({ similarity, relevant: article.relevant });
      }
    }
  }

  const results: ThresholdResult[] = sweepThresholds(scored, thresholds);
  const rec = recommendThreshold(results, 0.85);

  // Select threshold based on policy
  const selected = selectThreshold(rec, args.policy);
  const entry = renderThresholdEntry(selected);

  // Handle environment file writing
  if (args.writeEnv && !args.dryRun) {
    try {
      let content = "";
      try {
        content = readFileSync(args.envFile, "utf-8");
      } catch {
        // File doesn't exist, start with empty content
        content = "";
      }
      const updated = upsertEnvVar(content, "SIMILARITY_THRESHOLD", selected.toFixed(2));
      writeFileSync(args.envFile, updated, "utf-8");
      if (!args.offline) {
        console.error(
          `オフラインmock由来の閾値です。本番反映前に --offline なしで実チューニングを実施してください`,
        );
      }
    } catch (err) {
      console.error(`.env ファイルの書き込みに失敗しました: ${err}`);
      process.exit(1);
    }
  }

  // Dry run output
  if (args.dryRun) {
    console.error(`(dry-run) 以下を ${args.envFile} に書き込みます: ${entry}`);
  }

  // JSON output mode
  if (args.json) {
    const output = {
      mode: args.offline ? "offline" : "real",
      dataset: args.dataset,
      samples,
      articles: scored,
      recommendation: rec,
      results,
      policy: args.policy,
      selectedThreshold: selected,
      envEntry: entry,
      envFile: args.writeEnv ? args.envFile : null,
      envWritten: args.writeEnv && !args.dryRun,
    };
    process.stdout.write(JSON.stringify(output, null, 2));
    return;
  }

  // ---- Render table ----
  const header = "threshold | precision | recall | f1    | tp | fp | fn | tn";
  const sep = "----------+----------+--------+-------+----+----+----+----";
  const rows = results
    .map((r) =>
      [
        r.threshold.toFixed(2).padStart(8),
        r.precision.toFixed(2).padStart(8),
        r.recall.toFixed(2).padStart(6),
        r.f1.toFixed(2).padStart(5),
        String(r.tp).padStart(2),
        String(r.fp).padStart(2),
        String(r.fn).padStart(2),
        String(r.tn).padStart(2),
      ].join(" | "),
    )
    .join("\n");

  console.log(
    `\nThreshold tuning report (${args.offline ? "OFFLINE mock embeddings" : "REAL embeddings"})`,
  );
  console.log(`Dataset: ${args.dataset}  Samples: ${samples.length}  Articles: ${scored.length}`);
  console.log(`\n${header}\n${sep}\n${rows}\n`);
  console.log(`Recommendation:`);
  console.log(
    `  maxF1 threshold       = ${rec.maxF1Threshold.toFixed(2)} (f1=${rec.maxF1.toFixed(2)})`,
  );
  console.log(
    `  recall>=${rec.recallTarget} threshold = ${
      rec.recallTargetThreshold === null
        ? "NONE (raise max or lower step)"
        : rec.recallTargetThreshold.toFixed(2)
    }`,
  );
  console.log(
    `\nSet SIMILARITY_THRESHOLD=${rec.maxF1Threshold.toFixed(2)} (balanced) or ${
      rec.recallTargetThreshold ?? rec.maxF1Threshold.toFixed(2)
    } (recall-first) in your environment.\n`,
  );
  if (args.writeEnv && !args.dryRun) {
    console.log(`written to ${args.envFile}`);
  }
}

main().catch((err) => {
  console.error("[tune-threshold] Failed:", err);
  process.exit(1);
});
