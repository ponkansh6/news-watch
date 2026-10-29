import { defineConfig } from "drizzle-kit";

// `drizzle-kit push` diffs the entire remote database against this repository's
// partial schema and can propose dropping tables it does not know about.
// Reject the exact standalone `push` token regardless of CLI argument ordering.
if (process.argv.slice(2).some((argument) => argument === "push")) {
  throw new Error(
    "drizzle-kit push is disabled because it may propose dropping remote tables. Generate and review an additive SQL migration; use pnpm run db:migrate for a matching ledger or pnpm run db:apply-additive -- <journal-migration-tag> for a divergent ledger.",
  );
}

// Migrations can contain destructive statements too. Only the repository's
// guarded wrapper validates pending SQL before invoking Drizzle Kit.
if (
  process.argv.slice(2).some((argument) => argument === "migrate") &&
  process.env.NEWS_WATCH_SAFE_DB_MIGRATIONS !== "1"
) {
  throw new Error(
    "Direct drizzle-kit migrate is disabled. Validate pending additive migrations with `pnpm run db:migrate`.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
