#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  console.error("No .env.local found");
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("Connecting to:", url);
const client = createClient({ url, authToken });
const db = drizzle({ client });

try {
  // Check tables
  const tables = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  // db.run returns { rows, columns, ... }
  const tableNames = tables.rows.map((r) => r.name);
  console.log("Tables in DB:", tableNames);

  if (tableNames.includes("hatena_feeds")) {
    const result = await db.run(sql`SELECT COUNT(*) as cnt FROM hatena_feeds`);
    console.log("\nhatena_feeds row count:", result.rows[0].cnt);

    const breakdown = await db.run(
      sql`SELECT status, COUNT(*) as cnt FROM hatena_feeds GROUP BY status ORDER BY cnt DESC`,
    );
    console.log("Status breakdown:");
    for (const row of breakdown.rows) {
      console.log(`  ${row.status}: ${row.cnt}`);
    }
  } else {
    console.log("\n❌ hatena_feeds table does NOT exist in the remote database.");
    console.log("   Migration 0003_old_shen.sql has not been pushed to Turso.");
  }
} catch (err) {
  console.error("Query failed:", err.message || err);
}

client.close();
