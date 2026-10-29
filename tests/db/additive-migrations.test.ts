import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { createClient } from "@libsql/client";
import {
  applyAdditiveStatements,
  parseAdditiveMigration,
  parseMigrationTagArgument,
} from "../../scripts/lib/additive-migrations.mjs";

const clients = new Set<ReturnType<typeof createClient>>();
const migrationArgumentCases: Array<[string[], string]> = [
  [["0012_famous_trauma"], "0012_famous_trauma"],
  [["--", "0012_famous_trauma"], "0012_famous_trauma"],
];

function createMemoryClient() {
  const client = createClient({ url: ":memory:" });
  clients.add(client);
  return client;
}

afterEach(() => {
  for (const client of clients) client.close();
  clients.clear();
});

describe("additive migration guard", () => {
  test.each(migrationArgumentCases)("parses migration CLI arguments %j", (args, expected) => {
    expect(parseMigrationTagArgument(args)).toBe(expected);
  });

  test("allows table, column, and index additions", async () => {
    const statements = await parseAdditiveMigration(`
      CREATE TABLE example (id INTEGER PRIMARY KEY);
      --> statement-breakpoint
      ALTER TABLE example ADD COLUMN label TEXT;
      --> statement-breakpoint
      CREATE INDEX idx_example_label ON example (label);
    `);

    const client = createMemoryClient();
    await applyAdditiveStatements(client, statements);

    const columns = await client.execute("PRAGMA table_info(example)");
    expect(columns.rows.map((row) => row.name)).toEqual(["id", "label"]);
    const indexes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_example_label'",
    );
    expect(indexes.rows).toHaveLength(1);
  });

  test("validates and atomically applies the actual 0012 migration", async () => {
    const migrationUrl = new URL(
      "../../src/lib/db/migrations/0012_famous_trauma.sql",
      import.meta.url,
    );
    const migrationSql = await readFile(migrationUrl, "utf8");
    const statements = await parseAdditiveMigration(migrationSql);
    const client = createMemoryClient();

    await applyAdditiveStatements(client, statements);

    const expectedTables = ["refresh_job_slot", "refresh_job_sources", "refresh_jobs"];
    const expectedIndexes = [
      "refresh_job_sources_job_source_unique",
      "idx_refresh_job_sources_order",
      "refresh_jobs_workflow_run_id_unique",
      "idx_refresh_jobs_status_updated",
    ];
    const result = await client.execute({
      sql: `SELECT type, name FROM sqlite_master WHERE (type = 'table' AND name IN (${expectedTables.map(() => "?").join(", ")})) OR (type = 'index' AND name IN (${expectedIndexes.map(() => "?").join(", ")}))`,
      args: [...expectedTables, ...expectedIndexes],
    });

    const actualTables = result.rows.filter((row) => row.type === "table").map((row) => row.name);
    const actualIndexes = result.rows.filter((row) => row.type === "index").map((row) => row.name);
    expect(actualTables.sort()).toEqual(expectedTables.sort());
    expect(actualIndexes.sort()).toEqual(expectedIndexes.sort());
  });

  test.each([
    ["table deletion", "DROP TABLE example;"],
    ["column deletion", "ALTER TABLE example DROP COLUMN label;"],
    ["unknown SQL", "DELETE FROM example;"],
    ["multiple statements", "CREATE TABLE example (id INTEGER); DROP TABLE example;"],
    ["trailing table statement", "CREATE TABLE safe (id INTEGER) DROP TABLE unsafe"],
    ["trailing column statement", "ALTER TABLE example ADD COLUMN label TEXT DROP TABLE unsafe"],
    ["trailing index statement", "CREATE INDEX safe_idx ON example (id) DROP TABLE unsafe"],
    [
      "trailing block comment payload",
      "CREATE TABLE safe (id INTEGER) /* note */ DROP TABLE unsafe",
    ],
    ["trailing line comment payload", "CREATE TABLE safe (id INTEGER) -- note\nDROP TABLE unsafe"],
    ["semicolon in a value", "CREATE TABLE safe (value TEXT DEFAULT 'a;b')"],
  ])("rejects %s", async (_label, sql) => {
    await expect(parseAdditiveMigration(sql)).rejects.toThrow();
  });

  test("accepts leading comments and one trailing semicolon", async () => {
    await expect(
      parseAdditiveMigration("-- generated migration\nCREATE TABLE safe (id INTEGER);"),
    ).resolves.toHaveLength(1);
  });

  test("rolls back every statement if a later additive statement fails", async () => {
    const client = createMemoryClient();
    await expect(
      applyAdditiveStatements(client, [
        "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY)",
        "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY)",
      ]),
    ).rejects.toThrow();

    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'",
    );
    expect(result.rows).toHaveLength(0);
  });
});
