import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";

export function createInMemoryDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  return { db, __client: client };
}

/**
 * DDL statements matching the Drizzle schema in src/lib/db/schema.ts.
 * Kept as explicit SQL because Drizzle ORM does not auto-create tables
 * in SQLite. Keep in sync with the schema file when adding columns.
 */
export const CREATE_ARTICLES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    url_to_image TEXT,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_id TEXT,
    author TEXT,
    keyword TEXT,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;
