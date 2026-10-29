import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { parseAdditiveMigration } from "./lib/additive-migrations.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = resolve(projectRoot, "src/lib/db/migrations");
const journalPath = resolve(migrationRoot, "meta/_journal.json");

function fail(message) {
  throw new Error(message);
}

async function main() {
  try {
    process.loadEnvFile(resolve(projectRoot, ".env.local"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!databaseUrl || !authToken) {
    fail("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required to inspect the migration ledger.");
  }

  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch {
    fail("the Drizzle migration journal could not be read.");
  }

  if (
    journal.dialect !== "turso" ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0
  ) {
    fail("the Drizzle migration journal has no entries.");
  }

  const client = createClient({ url: databaseUrl, authToken });
  let pending;
  try {
    let ledgerRows;
    try {
      const result = await client.execute(
        "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      );
      ledgerRows = result.rows;
    } catch {
      fail(
        "the remote __drizzle_migrations ledger is unavailable; refusing to guess which migrations are pending.",
      );
    }

    if (!ledgerRows?.length) {
      fail(
        "the remote migration ledger is empty; automatic bootstrap is disabled because historical migrations include destructive SQL.",
      );
    }

    const lastApplied = ledgerRows[0];
    const lastAppliedAt = Number(lastApplied.created_at);
    if (!Number.isFinite(lastAppliedAt)) {
      fail("the latest migration timestamp is invalid.");
    }

    const latestMatchingEntries = journal.entries.filter(
      (entry) => Number(entry.when) === lastAppliedAt,
    );
    if (latestMatchingEntries.length === 0) {
      fail(
        "the latest remote migration timestamp is not present in this repository's journal; refusing an unknown database target.",
      );
    }

    const matchingHash = await Promise.all(
      latestMatchingEntries.map(async (entry) => {
        const sql = await readFile(resolve(migrationRoot, `${entry.tag}.sql`), "utf8");
        return createHash("sha256").update(sql).digest("hex") === lastApplied.hash;
      }),
    );
    if (!matchingHash.some(Boolean)) {
      fail("the latest remote migration hash does not match this repository's journal.");
    }

    pending = journal.entries.filter((entry) => Number(entry.when) > lastAppliedAt);

    for (const entry of pending) {
      const migrationPath = resolve(migrationRoot, `${entry.tag}.sql`);
      let sql;
      try {
        sql = await readFile(migrationPath, "utf8");
      } catch {
        fail(`migration file ${entry.tag}.sql is missing.`);
      }

      try {
        await parseAdditiveMigration(sql);
      } catch (error) {
        fail(
          `pending migration ${entry.tag}.sql is not additive: ${error instanceof Error ? error.message : "unsupported SQL"}.`,
        );
      }
    }
  } finally {
    client.close();
  }

  if (pending.length === 0) {
    console.log("No pending migrations; nothing to apply.");
    return;
  }

  console.log(
    `Validated ${pending.length} pending additive migration(s). Applying them with Drizzle Kit...`,
  );
  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: projectRoot,
    env: { ...process.env, NEWS_WATCH_SAFE_DB_MIGRATIONS: "1" },
    stdio: "inherit",
  });

  if (result.error) {
    fail(`could not start drizzle-kit migrate: ${result.error.message}`);
  }
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(
    `Safe migration aborted: ${error instanceof Error ? error.message : "unexpected error"}`,
  );
  process.exitCode = 1;
});
