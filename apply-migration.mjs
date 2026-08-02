import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const client = createClient({ url, authToken });

const statements = [
  "DROP INDEX IF EXISTS idx_relevance_pub",
  "DROP INDEX IF EXISTS idx_recency_pub",
  "CREATE INDEX idx_source_score_pub ON articles (source_id, score, published_at)",
];

(async () => {
  try {
    for (const stmt of statements) {
      console.log(`Executing: ${stmt}`);
      await client.execute(stmt);
      console.log("✓ Success");
    }
    console.log("\n✓ All migrations applied successfully to Turso");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
