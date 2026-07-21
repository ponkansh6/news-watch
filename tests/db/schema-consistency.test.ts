import { describe, expect, test } from "vitest";
import { Table } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Extract Drizzle Table objects from the schema module. Drizzle Table
// instances do NOT expose a plain `name` property (it is a symbol/getter),
// so we detect them via `instanceof Table` and read the name via the
// internal `Table.Symbol.Name` symbol.
function getSchemaTables(): { table: Table; name: string }[] {
  return Object.values(schema)
    .filter((t: unknown): t is Table => t instanceof Table)
    .map((table) => ({
      table,
      // @ts-expect-error Table.Symbol exists at runtime but is not in the type defs
      name: (table as any)[Table.Symbol.Name] as string,
    }));
}

describe("schema consistency", () => {
  test("all tables in schema.ts should exist in database", async () => {
    const tables = getSchemaTables();
    expect(tables.length, "schema.ts should define at least one table").toBeGreaterThan(0);

    for (const { name } of tables) {
      // Throws (no such table) if the migration was not applied.
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

      // Handle different result structures (e.g. array of rows or object with rows)
      const rows = Array.isArray(result) ? result : (result as any).rows || [];
      const actualColumns = rows.map((row: any) => row.name);

      for (const col of expectedColumns) {
        expect(actualColumns, `Column ${col} missing in table ${name}`).toContain(col);
      }
    }
  });
});
