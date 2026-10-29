import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  applyAdditiveStatements,
  parseAdditiveMigration,
  parseMigrationTagArgument,
} from "./lib/additive-migrations.mjs";

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
    if (error?.code !== "ENOENT") {
      fail("could not load the local environment file.");
    }
  }

  let migrationId;
  try {
    migrationId = parseMigrationTagArgument(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : "invalid migration argument.");
  }

  const databaseUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!databaseUrl || !authToken) {
    fail("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  }

  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch {
    fail("the Drizzle migration journal could not be read.");
  }

  if (journal.dialect !== "turso" || !Array.isArray(journal.entries)) {
    fail("the Drizzle migration journal is invalid.");
  }

  const entry = journal.entries.find((candidate) => candidate.tag === migrationId);
  if (!entry) {
    fail(`migration tag ${migrationId} is not present in the local journal.`);
  }

  const migrationPath = resolve(migrationRoot, `${entry.tag}.sql`);
  let sql;
  try {
    sql = await readFile(migrationPath, "utf8");
  } catch {
    fail(`migration file ${entry.tag}.sql is missing.`);
  }

  let statements;
  try {
    statements = await parseAdditiveMigration(sql);
  } catch (error) {
    fail(
      `migration ${entry.tag}.sql is not additive: ${error instanceof Error ? error.message : "unsupported SQL"}.`,
    );
  }

  let client;
  try {
    client = createClient({ url: databaseUrl, authToken });
  } catch {
    fail(
      "the configured Turso connection could not be initialized; connection details are hidden.",
    );
  }

  try {
    await applyAdditiveStatements(client, statements);
  } catch (error) {
    let message = error instanceof Error ? error.message : "database rejected the migration";
    message = message
      .replaceAll(databaseUrl, "[database URL]")
      .replaceAll(authToken, "[auth token]");
    fail(`migration ${entry.tag}.sql was rolled back: ${message}`);
  } finally {
    client.close();
  }

  console.log(
    `Applied ${entry.tag}.sql atomically (${statements.length} statements). The shared __drizzle_migrations ledger was not changed.`,
  );
}

main().catch((error) => {
  console.error(
    `Additive migration aborted: ${error instanceof Error ? error.message : "unexpected error"}`,
  );
  process.exitCode = 1;
});
