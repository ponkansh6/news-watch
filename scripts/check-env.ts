#!/usr/bin/env tsx
/**
 * Environment validation script.
 * Checks that all required env vars are set and warns about optional ones.
 *
 * Usage: pnpm tsx scripts/check-env.ts
 * Or add as "check-env" script in package.json.
 */

/* eslint-disable no-console */

const REQUIRED = {
  TURSO_DATABASE_URL: "Turso DB connection string",
  TURSO_AUTH_TOKEN: "Turso DB auth token",
  GOOGLE_API_KEY: "Gemini API key for article scoring",
} as const;

const OPTIONAL = {
  GNEWS_API_KEY: "GNews API key (required if gnews source selected)",
  NEWS_API_KEY: "NewsAPI key (required if newsapi source selected)",
  QSTASH_TOKEN: "QStash token (empty = local dev mode, article scored inline)",
  QSTASH_CURRENT_SIGNING_KEY: "QStash signing key (required for QStash webhook verification)",
  QSTASH_NEXT_SIGNING_KEY: "QStash next signing key (required for key rotation)",
  SCORE_URL: "Public URL for QStash callback (required for local QStash testing via ngrok)",
};

let hasError = false;

console.log("=== Environment Validation ===\n");

// Check required
for (const [key, desc] of Object.entries(REQUIRED)) {
  if (process.env[key]) {
    const val = process.env[key]!;
    const masked = val.length > 8 ? val.slice(0, 4) + "..." + val.slice(-4) : "***";
    console.log(`  ✅ ${key} = ${masked}  (${desc})`);
  } else {
    console.log(`  ❌ ${key} is MISSING  (${desc})`);
    hasError = true;
  }
}

// Check QStash special case (either all-or-nothing)
const qstashToken = process.env.QSTASH_TOKEN;
const qstashCurrent = process.env.QSTASH_CURRENT_SIGNING_KEY;
const qstashNext = process.env.QSTASH_NEXT_SIGNING_KEY;
const hasFullQstash = qstashToken && qstashCurrent && qstashNext;
const hasPartialQstash = qstashToken || qstashCurrent || qstashNext;

if (hasFullQstash) {
  console.log(`\n  ✅ QStash fully configured — production mode`);
  if (process.env.SCORE_URL) {
    console.log(`  ✅ SCORE_URL = ${process.env.SCORE_URL}`);
  } else {
    console.log(`  ⚠️  SCORE_URL not set — QStash will use VERCEL_URL or request host`);
  }
} else if (hasPartialQstash) {
  console.log(`\n  ⚠️  QStash partially configured. For production, set all three:`);
  console.log(`     QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY`);
} else {
  console.log(`\n  ℹ️  QStash not configured — running in local dev mode (direct scoring)`);
}

// Check optional
for (const [key, desc] of Object.entries(OPTIONAL)) {
  if (key.startsWith("QSTASH")) continue; // handled above
  if (process.env[key]) {
    const val = process.env[key]!;
    const masked = val.length > 8 ? val.slice(0, 4) + "..." + val.slice(-4) : "***";
    console.log(`  ◻️  ${key} = ${masked}  (${desc})`);
  } else {
    console.log(`  ◻️  ${key} not set  (${desc})`);
  }
}

console.log(`\n${hasError ? "❌ Some required env vars are missing" : "✅ All required env vars present"}`);

if (hasError) {
  process.exit(1);
}
