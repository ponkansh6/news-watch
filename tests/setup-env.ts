import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local so Vitest has the same env as the Next.js dev server,
// EXCEPT the Turso credentials. The `db` module falls back to an isolated
// in-memory SQLite when TURSO_DATABASE_URL is unset, which keeps tests
// deterministic and prevents them from touching the production database
// (e.g. scoring-polling.test.ts drops/recreates the `articles` table).
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
    // Skip Turso credentials so tests use an isolated in-memory database.
    if (key === "TURSO_DATABASE_URL" || key === "TURSO_AUTH_TOKEN") continue;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local missing — tests relying on it will be skipped by their guards.
}
