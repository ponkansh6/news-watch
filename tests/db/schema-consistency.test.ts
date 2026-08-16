import { describe, expect, test } from "vitest";
import { Table } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

function getSchemaTables(): { table: Table; name: string }[] {
  return Object.values(schema)
    .filter((t: unknown): t is Table => t instanceof Table)
    .map((table) => ({
      table,
      // @ts-expect-error Table.Symbol exists at runtime
      name: (table as any)[Table.Symbol.Name] as string,
    }));
}

describe("schema consistency", () => {
  test("all tables in schema.ts should exist in database", async () => {
    const tables = getSchemaTables();
    expect(tables.length, "schema.ts should define at least one table").toBeGreaterThan(0);

    for (const { name } of tables) {
      await db.$client.execute(`SELECT 1 FROM ${name} LIMIT 1`);
    }
  });

  test("all tables in schema.ts should be created in migrations", async () => {
    const tables = getSchemaTables();
    const tableNames = tables.map((t) => t.name);

    const migrationsDir = resolve(__dirname, "../../src/lib/db/migrations");
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

    const createdTables: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), "utf-8");
      const matches = content.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/gi);
      for (const m of matches) createdTables.push(m[1]);
    }

    for (const tableName of tableNames) {
      expect(createdTables, `Table ${tableName} not found in migrations`).toContain(tableName);
    }
  });

  test("all columns in schema.ts should exist in database", async () => {
    const tables = getSchemaTables();

    for (const { table, name } of tables) {
      const expectedColumns = Object.values(table)
        .filter((val: any) => val && typeof val === "object" && "name" in val)
        .map((col: any) => col.name);

      const result = await db.$client.execute(`PRAGMA table_info(${name})`);
      const rows = Array.isArray(result) ? result : (result as any).rows || [];
      const actualColumns = rows.map((row: any) => row.name);

      for (const col of expectedColumns) {
        expect(actualColumns, `Column ${col} missing in table ${name}`).toContain(col);
      }
    }
  });

  test("keyword_embeddings table and articles.embedding column do not exist", async () => {
    // keyword_embeddings table should not exist
    const tablesResult = await db.$client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='keyword_embeddings'`,
    );
    const tablesRows = Array.isArray(tablesResult)
      ? tablesResult
      : (tablesResult as any).rows || [];
    expect(tablesRows.length).toBe(0);

    // articles table should not have 'embedding' column
    const articleInfo = await db.$client.execute(`PRAGMA table_info(articles)`);
    const articleRows = Array.isArray(articleInfo) ? articleInfo : (articleInfo as any).rows || [];
    const actualColumns = articleRows.map((r: any) => r.name);
    expect(actualColumns).not.toContain("embedding");
  });

  test("migration 0010 exists and drops keyword_embeddings and embedding", () => {
    const migrationsDir = resolve(__dirname, "../../src/lib/db/migrations");
    const files = readdirSync(migrationsDir).filter((f) => /^0010_.*\.sql$/.test(f));
    expect(files.length, "Migration 0010 file not found").toBeGreaterThan(0);
    const migrationPath = join(migrationsDir, files[0]);
    const content = readFileSync(migrationPath, "utf-8");
    expect(content).toContain("DROP TABLE `keyword_embeddings`");
    expect(content).toContain("DROP COLUMN `embedding`");
  });

  test("articles.keyword is nullable (schema.ts と実適用 SQL の drift 検出（0006 欠落再発防止）)", async () => {
    const articleInfo = await db.$client.execute(`PRAGMA table_info(articles)`);
    const articleRows = Array.isArray(articleInfo) ? articleInfo : (articleInfo as any).rows || [];
    const keywordCol = articleRows.find((r: any) => r.name === "keyword");
    expect(keywordCol, "keyword column exists").toBeDefined();
    // notnull should be 0 (nullable)
    expect(keywordCol.notnull).toBe(0);
  });
});
