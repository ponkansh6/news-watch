#!/usr/bin/env node
import { createClient } from "@libsql/client";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7) ?? "warm";
const expectArgument = process.argv.find((arg) => arg.startsWith("--expect="))?.slice(9);
const expected = expectArgument ?? (mode === "warm" ? "stale" : "fresh");
const referenceTimestampInput = process.env.PLAN22_REFERENCE_TIMESTAMP
  ? new Date(process.env.PLAN22_REFERENCE_TIMESTAMP)
  : new Date();
const referenceTimestamp = `${referenceTimestampInput.toISOString().slice(0, 19)}Z`;
if (!new Set(["warm", "cold", "action"]).has(mode) || !new Set(["stale", "fresh"]).has(expected)) {
  throw new Error(
    "Usage: pnpm run build && node scripts/smoke-first-fetch-refresh.mjs --case=warm --expect=stale|fresh, or --case=cold --expect=fresh",
  );
}
if (
  (mode !== "warm" && expected !== "fresh") ||
  (mode === "warm" && !new Set(["stale", "fresh"]).has(expected))
) {
  throw new Error(`Invalid smoke case/expect combination: --case=${mode} --expect=${expected}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "news-watch-plan22-"));
const dbPath = join(tempRoot, "fixture.db");
const dbUrl = `file:${dbPath}`;
const nextRoot = join(tempRoot, "app");
const port = Number(process.env.SMOKE_PORT ?? "3187");
const origin = `http://127.0.0.1:${port}`;
const secret = "plan22-local-smoke-secret";
const recordPath = resolve(
  process.env.SMOKE_RECORD ?? join(tmpdir(), `news-watch-plan22-result-${process.pid}.json`),
);
const serverStdoutPath = `${recordPath}.server.stdout.log`;
const serverStderrPath = `${recordPath}.server.stderr.log`;
const fixtureBScoring = { relevance: 8, usefulness: 8, recency: 10 };
const expectedBScore =
  Math.round(
    (fixtureBScoring.relevance * 0.1 +
      fixtureBScoring.usefulness * 0.6 +
      fixtureBScoring.recency * 0.3) *
      10,
  ) / 10;
const displayCriteria = {
  sourceId: "yamadashy",
  minimumScore: 5,
  limit: 100,
  publishedWithinDays: null,
  staleLowScoreRetentionDays: 30,
};
let server;

function linkProjectEntry(name) {
  const source = join(root, name);
  try {
    symlinkSync(source, join(nextRoot, name), "dir");
  } catch {
    symlinkSync(source, join(nextRoot, name), "file");
  }
}

async function initializeDatabase() {
  const client = createClient({ url: dbUrl });
  const migrationsPath = join(root, "src/lib/db/migrations");
  for (const file of readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(join(migrationsPath, file), "utf8");
    for (const statement of migration
      .split(/--> statement-breakpoint|;/)
      .map((sql) => sql.trim())
      .filter(Boolean)) {
      await client.execute(statement);
    }
  }

  if (mode !== "cold") {
    const now = new Date(referenceTimestamp).toISOString();
    const publishedAt = new Date(referenceTimestamp).toUTCString();
    await client.execute({
      sql: `INSERT INTO articles
        (title, description, url, published_at, source_name, source_id, summary,
         relevance, usefulness, recency, reason, scored_at, score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "Plan22 fixture A",
        "Warm-cache baseline article.",
        "https://fixture.news-watch.invalid/articles/plan22-a",
        publishedAt,
        "Tech Blog",
        "yamadashy",
        "Fixture summary A",
        8,
        8,
        10,
        "Fixture reason A",
        now,
        9,
        now,
      ],
    });
  }
  await client.close();
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${origin}/api/fetch-news`);
      if (response.ok) return;
    } catch {
      // The production server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Next.js production server did not become ready within 30 seconds");
}

async function assertPortAvailable() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}

async function main() {
  await assertPortAvailable();
  mkdirSync(nextRoot, { recursive: true });
  await initializeDatabase();
  cpSync(join(root, ".next"), join(nextRoot, ".next"), { recursive: true });
  for (const name of ["node_modules", "package.json", "next.config.ts", "public"]) {
    try {
      linkProjectEntry(name);
    } catch (error) {
      if (name !== "public") throw error;
    }
  }

  const fixtureLoader = join(root, "scripts/fixtures/first-fetch-refresh.mjs");
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${fixtureLoader}`]
    .filter(Boolean)
    .join(" ");
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(serverStdoutPath, "");
  writeFileSync(serverStderrPath, "");
  server = spawn(
    process.execPath,
    [
      join(root, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: nextRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
        PLAN22_REFERENCE_TIMESTAMP: referenceTimestamp,
        PLAN22_FIXTURE_B_RELEVANCE: String(fixtureBScoring.relevance),
        PLAN22_FIXTURE_B_USEFULNESS: String(fixtureBScoring.usefulness),
        TURSO_DATABASE_URL: dbUrl,
        TURSO_AUTH_TOKEN: "",
        GOOGLE_API_KEY: "plan22-fixture-key",
        CRON_SECRET: secret,
        ADMIN_BASIC_AUTH_USER: "plan22-smoke-admin",
        ADMIN_BASIC_AUTH_PASSWORD: "plan22-smoke-admin-password",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => appendFileSync(serverStdoutPath, chunk));
  server.stderr.on("data", (chunk) => appendFileSync(serverStderrPath, chunk));
  await waitUntilReady();

  let warmSetup = { status: null, hasA: false };
  if (mode !== "cold") {
    const warmResponse = await fetch(`${origin}/?source=yamadashy`);
    const warmBody = await warmResponse.text();
    warmSetup = { status: warmResponse.status, hasA: warmBody.includes("Plan22 fixture A") };
  }

  const postStartedAt = performance.now();
  let postResponse;
  let postBody;
  let postTransportError;
  try {
    postResponse = await fetch(`${origin}/api/fetch-news`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        ...(mode === "action" ? { accept: "application/x-ndjson" } : {}),
      },
      body: JSON.stringify({ source: "yamadashy" }),
    });
    const postText = await postResponse.text();
    try {
      postBody =
        mode === "action"
          ? postText
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
              .findLast((event) => event.type === "result")
          : JSON.parse(postText);
    } catch {
      postBody = { malformedJson: true, body: postText };
    }
  } catch (error) {
    postTransportError = String(error);
  }
  const postElapsedMs = performance.now() - postStartedAt;

  const dbVerifierStartedAt = performance.now();
  const verifier = createClient({ url: dbUrl });
  const saved = await verifier.execute({
    sql: `SELECT id, title, url, source_id, published_at, recency, score, relevance,
      usefulness, scored_at, created_at FROM articles WHERE url IN (?, ?)`,
    args: [
      "https://fixture.news-watch.invalid/articles/plan22-a",
      "https://fixture.news-watch.invalid/articles/plan22-b",
    ],
  });
  await verifier.close();
  const dbVerifierElapsedMs = performance.now() - dbVerifierStartedAt;
  const rowsByUrl = new Map(saved.rows.map((row) => [String(row.url), row]));
  const articleA = rowsByUrl.get("https://fixture.news-watch.invalid/articles/plan22-a") ?? null;
  const articleB = rowsByUrl.get("https://fixture.news-watch.invalid/articles/plan22-b") ?? null;

  let cacheInvalidationAction = { status: null, revalidatedHeader: null, response: null };
  if (mode === "action") {
    const manifest = JSON.parse(
      readFileSync(join(root, ".next/server/server-reference-manifest.json"), "utf8"),
    );
    const actionEntry = Object.entries(manifest.node ?? {}).find(
      ([, entry]) =>
        entry.filename === "app/actions.ts" &&
        entry.exportedName === "invalidateArticlesAfterFetch",
    );
    if (!actionEntry)
      throw new Error("Could not find invalidateArticlesAfterFetch in the Server Action manifest");
    const [actionId] = actionEntry;
    const adminUser = "plan22-smoke-admin";
    const adminPassword = "plan22-smoke-admin-password";
    const actionResponse = await fetch(`${origin}/`, {
      method: "POST",
      headers: {
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": actionId,
        origin,
        "next-router-state-tree": encodeURIComponent(
          JSON.stringify(["", { children: ["__PAGE__", {}] }]),
        ),
        authorization: `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`,
      },
      body: "[]",
    });
    const actionText = await actionResponse.text();
    cacheInvalidationAction = {
      status: actionResponse.status,
      contentType: actionResponse.headers.get("content-type"),
      revalidatedHeader: actionResponse.headers.get("x-action-revalidated"),
      actionNotFoundHeader: actionResponse.headers.get("x-next-action-not-found"),
      response: actionText.slice(0, 4_000),
    };
  }

  // This is the first list request after POST. Do not retry or read another list until recorded.
  const firstListStartedAt = performance.now();
  const firstListResponse = await fetch(`${origin}/?source=yamadashy`, {
    headers: { accept: "text/html" },
  });
  const firstListBody = await firstListResponse.text();
  const firstHasB = firstListBody.includes("Plan22 fixture B");
  const firstResult = {
    case: mode,
    referenceTimestamp,
    cacheWarmBeforePost: mode === "warm",
    warmSetup,
    postStatus: postResponse?.status ?? null,
    postElapsedMs,
    postTransportError: postTransportError ?? null,
    pipelineResponse: postBody ?? null,
    cacheInvalidationAction,
    databaseArticles: { a: articleA, b: articleB },
    dbVerifierElapsedMs,
    firstListStatus: firstListResponse.status,
    firstListElapsedMs: performance.now() - firstListStartedAt,
    firstListHasB: firstHasB,
    firstListHasA: firstListBody.includes("Plan22 fixture A"),
    expected: {
      fixtureBScoring,
      scoreFormulaWeights: { relevance: 0.1, usefulness: 0.6, recency: 0.3 },
      recency: fixtureBScoring.recency,
      score: expectedBScore,
      displayCriteria: {
        ...displayCriteria,
        expectedArticleCount: mode === "cold" ? 1 : 2,
        actualFixtureArticleCount: saved.rows.length,
      },
    },
    assertions: "pending",
    serverStdoutPath,
    serverStderrPath,
  };
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(firstResult, null, 2)}\n`);
  writeFileSync(`${recordPath}.html`, firstListBody);
  console.log(
    `[plan22:first-list] ${JSON.stringify({ ...firstResult, recordPath, responsePath: `${recordPath}.html` })}`,
  );

  if (firstListResponse.status !== 200) {
    firstResult.assertions = { firstListStatusOk: false };
    writeFileSync(recordPath, `${JSON.stringify(firstResult, null, 2)}\n`);
    throw new Error(
      `First list request returned ${firstListResponse.status}; response artifact was saved`,
    );
  }

  const referenceTimestampMs = new Date(referenceTimestamp).getTime();
  const articleAPublishedAtMs = articleA
    ? new Date(String(articleA.published_at)).getTime()
    : Number.NaN;
  const articleBPublishedAtMs = articleB
    ? new Date(String(articleB.published_at)).getTime()
    : Number.NaN;
  const apiSucceeded =
    postResponse?.ok === true &&
    postBody?.ok === true &&
    postBody.results?.[0]?.errors?.length === 0;
  const assertions = {
    firstListStatusOk: firstListResponse.status === 200,
    apiSucceeded,
    databaseBPresent: articleB !== null,
    databaseArticleCountMatchesCase: saved.rows.length === (mode === "cold" ? 1 : 2),
    warmSetupContainedA: mode === "cold" || (warmSetup.status === 200 && warmSetup.hasA),
    aPresentOnlyInWarmCase: mode !== "cold" ? articleA !== null : articleA === null,
    aAndBPublishedAtMatch: mode === "cold" || articleAPublishedAtMs === articleBPublishedAtMs,
    aPublishedAtMatchesReference: mode === "cold" || articleAPublishedAtMs === referenceTimestampMs,
    bPublishedAtMatchesReference: articleBPublishedAtMs === referenceTimestampMs,
    bRecencyMatchesExpected: articleB?.recency === fixtureBScoring.recency,
    bScoreMatchesExpected: articleB?.score === expectedBScore,
    bMeetsDisplayCriteria:
      articleB?.source_id === displayCriteria.sourceId &&
      typeof articleB.score === "number" &&
      articleB.score >= displayCriteria.minimumScore &&
      saved.rows.length <= displayCriteria.limit,
    serverActionInvalidatedCache:
      mode !== "action" ||
      (cacheInvalidationAction.status === 200 &&
        cacheInvalidationAction.revalidatedHeader !== null),
    firstListMatchesExpectation:
      mode === "action" || expected === "fresh"
        ? firstResult.firstListHasB
        : mode === "warm" && firstResult.firstListHasA && !firstResult.firstListHasB,
  };
  firstResult.assertions = assertions;
  writeFileSync(recordPath, `${JSON.stringify(firstResult, null, 2)}\n`);
  console.log(`[plan22:assertions] ${JSON.stringify(assertions)}`);

  const failedAssertions = Object.entries(assertions)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  if (failedAssertions.length > 0) {
    throw new Error(`Plan 22 smoke assertions failed: ${failedAssertions.join(", ")}`);
  }

  // A subsequent observation is allowed only after the first response is written above.
  const followupResponse = await fetch(`${origin}/?source=yamadashy`, {
    headers: { accept: "text/html" },
  });
  const followupBody = await followupResponse.text();
  const followupHasB = followupBody.includes("Plan22 fixture B");
  const followupResult = { status: followupResponse.status, hasB: followupHasB };
  console.log(`[plan22:follow-up] ${JSON.stringify(followupResult)}`);
  writeFileSync(`${recordPath}.follow-up.json`, `${JSON.stringify(followupResult, null, 2)}\n`);

  const followupAssertion = {
    staleWarmFollowupContainsB:
      mode === "action" ||
      mode !== "warm" ||
      expected !== "stale" ||
      (followupResponse.status === 200 && followupHasB),
  };
  firstResult.followupAssertions = followupAssertion;
  writeFileSync(recordPath, `${JSON.stringify(firstResult, null, 2)}\n`);
  if (!followupAssertion.staleWarmFollowupContainsB) {
    throw new Error(
      "Expected warm-cache stale first response followed by B on a successful later read",
    );
  }
}

try {
  await main();
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("close", resolve));
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
