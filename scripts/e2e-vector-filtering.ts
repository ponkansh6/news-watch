import { exit } from "process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
try {
  const envPath = resolve(__dirname, "..", ".env.local");
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
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
];
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Environment not configured. Set ${missing.join(", ")} in .env.local`);
  exit(1);
}

const targetUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/api`
  : "http://localhost:3000/api";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function run() {
  console.log(`🚀 Starting E2E Vector Filtering Test`);
  console.log(`Targeting: ${targetUrl}`);

  // 1. Fetch News
  console.log("--- Triggering Fetch News ---");
  try {
    const response = await fetch(`${targetUrl}/fetch-news`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: ["hackernews"] }),
    });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    console.log("✅ Fetch triggered");
  } catch (e) {
    console.error("❌ Fetch failed:", e);
    exit(1);
  }

  // Wait for embeddings to be generated (simple sleep)
  console.log("--- Waiting for embeddings to be generated ---");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 2. Trigger Scoring
  console.log("--- Triggering Score Articles ---");
  try {
    const response = await fetch(`${targetUrl}/score-articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles: [], keyword: "test" }), // ダミーデータ
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Scoring failed: ${response.status} ${JSON.stringify(err)}`);
    }
    console.log("✅ Scoring triggered");
  } catch (e) {
    console.error("❌ Scoring failed:", e);
    exit(1);
  }

  // 3. Verify Filtering
  console.log("--- Verifying Vector Filtering ---");
  
  const startTime = Date.now();
  const timeout = 60000;
  let success = false;

  while (Date.now() - startTime < timeout) {
    const result = await db.execute(
      "SELECT COUNT(*) as total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as with_embedding, SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) as scored FROM articles"
    );
    const row = result.rows[0];
    const total = Number(row.total);
    const withEmbedding = Number(row.with_embedding);
    const scored = Number(row.scored);

    console.log(`Stats: Total=${total}, WithEmbedding=${withEmbedding}, Scored=${scored}`);

    if (withEmbedding > 0 && scored > 0 && scored < withEmbedding) {
      console.log("✅ Vector filtering appears to be working (some articles with embeddings were not scored)");
      success = true;
      break;
    }
    
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (success) {
    console.log("🎉 E2E Vector Filtering Test Passed!");
    exit(0);
  } else {
    console.error("❌ E2E Vector Filtering Test Failed or Timed Out");
    exit(1);
  }
}

run();
