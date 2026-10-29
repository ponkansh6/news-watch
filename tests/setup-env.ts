import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, vi } from "vitest";

// Mock next/cache revalidateTag for tests (prevents "static generation store missing" errors)
vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>();
  return { ...actual, revalidateTag: vi.fn() };
});

// Load application settings but never point the shared test DB at Turso.
// A file-backed SQLite DB is required because libsql opens a fresh connection
// after each transaction; separate `:memory:` connections do not share state.
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
    // Test DBs are always local. RUN_LIVE_TESTS only enables explicitly live
    // HTTP integrations; it must never enable writes to the production DB.
    if (key === "TURSO_DATABASE_URL" || key === "TURSO_AUTH_TOKEN") continue;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local missing — tests relying on it will be skipped by their guards.
}

const testDbDirectory = mkdtempSync(join(tmpdir(), "news-watch-vitest-"));
process.env.TURSO_DATABASE_URL = `file:${join(testDbDirectory, "test.sqlite")}`;
delete process.env.TURSO_AUTH_TOKEN;

// Route-level fetch-news tests use a deterministic credential only when the
// caller and .env.local do not provide one.
if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = "test-secret";
}

// Apply all migrations to this test worker's local DB BEFORE any test runs.
// Registered as a global beforeAll so Vitest awaits completion before tests.
// If a migration is missing (e.g. schema.ts changed but `db:generate` was
// forgotten), the table won't exist and schema-consistency tests will FAIL —
// surfacing migration drift in CI / pre-push hook instead of production.
const migrationsDir = resolve(__dirname, "../src/lib/db/migrations");

async function applyMigrations() {
  // Keep setup independent of the application DB module: importing it can
  // evaluate queries that depend on next/cache, which test files may mock.
  // This client targets the same isolated SQLite file as the app client.
  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const expectedDatabaseUrl = `file:${join(testDbDirectory, "test.sqlite")}`;
  if (databaseUrl !== expectedDatabaseUrl) {
    throw new Error("Refusing to migrate a database outside the isolated Vitest directory");
  }
  const client = createClient({ url: expectedDatabaseUrl });
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  try {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      const statements = sql
        .split(/--> statement-breakpoint|;/)
        .map((s) => s.trim())
        .filter((s) => s !== "");
      for (const stmt of statements) {
        try {
          await client.execute(stmt);
        } catch (e) {
          console.error(`[setup] Failed to apply migration ${file}: ${stmt}`);
          throw e;
        }
      }
    }
  } finally {
    client.close();
  }
}

beforeAll(async () => {
  await applyMigrations();
});

afterAll(async () => {
  rmSync(testDbDirectory, { recursive: true, force: true });
});
