import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { beforeAll } from "vitest";
import { db } from "../src/lib/db";

// Load .env.local so Vitest has the same env as the Next.js dev server,
// EXCEPT the Turso credentials (by default). The `db` module falls back to an
// isolated in-memory SQLite when TURSO_DATABASE_URL is unset, which keeps tests
// deterministic and prevents them from touching the production database
// (e.g. scoring-polling.test.ts drops/recreates the `articles` table).
//
// When RUN_LIVE_TESTS=1, we DO load Turso credentials so live integration
// tests can read the real feed list from production. Live tests must avoid
// writing to the database.
const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

const envPath = resolve(__dirname, "../.env.local");
try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Skip Turso credentials unless running live integration tests.
    if (!RUN_LIVE && (key === "TURSO_DATABASE_URL" || key === "TURSO_AUTH_TOKEN")) continue;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local missing — tests relying on it will be skipped by their guards.
}

// Apply all migrations to the in-memory DB BEFORE any test runs.
// Registered as a global beforeAll so Vitest awaits completion before tests.
// If a migration is missing (e.g. schema.ts changed but `db:generate` was
// forgotten), the table won't exist and schema-consistency tests will FAIL —
// surfacing migration drift in CI / pre-push hook instead of production.
const migrationsDir = resolve(__dirname, "../src/lib/db/migrations");

async function applyMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const statements = sql
      .split(/--> statement-breakpoint|;/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    for (const stmt of statements) {
      try {
        await db.$client.execute(stmt);
      } catch (e) {
        console.error(`[setup] Failed to apply migration ${file}: ${stmt}`);
        throw e;
      }
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});
