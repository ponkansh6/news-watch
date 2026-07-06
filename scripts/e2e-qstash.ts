import { exit } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

// Load .env.local manually (tsx doesn't auto-load it)
try {
  const envPath = resolve(import.meta.dirname, "..", ".env.local");
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  /* .env.local missing — use existing env */
}

const requiredEnv = [
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "GOOGLE_API_KEY",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
];
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Environment not configured. Set ${missing.join(", ")} in .env.local`);
  exit(1);
}

const targetUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/api/fetch-news`
  : process.env.SCORE_URL
    ? `${process.env.SCORE_URL.replace(/\/api\/score-articles$/, "").replace(/\/$/, "")}/api/fetch-news`
    : "http://localhost:3000/api/fetch-news";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function run() {
  console.log(`🚀 Starting E2E Pipeline Test`);
  console.log(`Targeting: ${targetUrl}`);

  // 1. Verify Schema
  console.log("--- Checking Schema ---");
  try {
    const schema = await db.execute("PRAGMA table_info(articles)");
    const columns = schema.rows.map((r) => r.name);
    const hasSourceId = columns.includes("source_id");
    const hasCreatedAt = columns.includes("created_at");

    if (hasSourceId && hasCreatedAt) {
      console.log("✅ Schema check passed (source_id, created_at exist)");
    } else {
      console.error(
        `❌ Schema check failed. Missing: ${!hasSourceId ? "source_id " : ""}${!hasCreatedAt ? "created_at" : ""}`,
      );
      exit(1);
    }
  } catch (e) {
    console.error("❌ Schema check failed:", e);
    exit(1);
  }

  // 2. Trigger Fetch
  console.log("--- Triggering Fetch ---");
  let response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: ["hackernews"] }),
    });
  } catch (e) {
    console.error("❌ API call failed:", e);
    exit(1);
  }

  if (!response.ok) {
    console.error("❌ API returned error:", response.status);
    exit(1);
  }
  console.log("✅ API call queued successfully");

  // 3. Count initial scored articles (before)
  console.log("--- Polling for New Scored Articles (max 120s) ---");
  let initialCount = 0;
  try {
    const before = await db.execute(
      "SELECT COUNT(*) as cnt FROM articles WHERE score IS NOT NULL AND score > 0",
    );
    initialCount = Number(before.rows[0].cnt);
    console.log(`Initial scored articles: ${initialCount}`);
  } catch (e) {
    console.error("❌ DB query failed:", e);
    exit(1);
  }

  const startTime = Date.now();
  const timeout = 120000;
  let success = false;
  let finalCount = 0;

  while (Date.now() - startTime < timeout) {
    try {
      const result = await db.execute(
        "SELECT COUNT(*) as cnt FROM articles WHERE score IS NOT NULL AND score > 0",
      );
      finalCount = Number(result.rows[0].cnt);

      if (finalCount > initialCount) {
        const newArticles = finalCount - initialCount;
        console.log(`✅ Found ${newArticles} new scored articles (total: ${finalCount})`);
        success = true;
        break;
      }
      console.log("... waiting for new articles ...");
    } catch (e) {
      console.error("❌ DB query failed:", e);
      exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (success) {
    console.log("🎉 E2E Pipeline Test Passed!");
    exit(0);
  } else {
    console.error("❌ E2E Pipeline Test Timed Out");
    exit(1);
  }
}

run();
