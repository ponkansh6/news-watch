#!/bin/sh
# Check that the production Turso DB schema matches schema.ts.
# Read-only — does not modify the database.
# Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... scripts/check-prod-schema.sh

set -e

if [ -z "$TURSO_DATABASE_URL" ] || [ -z "$TURSO_AUTH_TOKEN" ]; then
  echo "⏭️  Skipping production schema check: TURSO_DATABASE_URL not set"
  exit 0
fi

echo "🔍 Checking production schema consistency..."

# Run a small Node.js script that uses @libsql/client to compare schemas
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
node -e "
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Parse schema.ts to extract expected column names for 'articles' table
  const schemaPath = path.join('$PROJECT_ROOT', 'src/lib/db/schema.ts');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  // Extract column definitions from the articles sqliteTable
  const match = schemaContent.match(/export const articles = sqliteTable\s*\(\s*\"articles\"\s*,\s*\{([^}]+)\}/s);
  if (!match) {
    console.error('Could not parse articles table schema');
    process.exit(1);
  }
  const colBlock = match[1];

  // Extract column names:    columnName: type("actual_db_name")
  const expected = new Set();
  const colRegex = /^\s*(\w+)\s*:\s*\w+\s*\(\s*\"(\w+)\"/gm;
  let m;
  while ((m = colRegex.exec(colBlock)) !== null) {
    expected.add(m[1]);  // TypeScript field name (camelCase)
  }

  // Get actual columns from production database
  const result = await client.execute('PRAGMA table_info(articles)');
  const actual = new Set(result.rows.map(r => r.name));

  // Find missing columns (schema.ts has it, DB doesn't)
  // PRAGMA returns snake_case column names; schema.ts uses camelCase field names
  // with snake_case DB column names in the second arg.  We compare the DB names.
  const missing = [];
  const colRegex2 = /\"(\w+)\"/g;
  expected.clear();
  while ((m = colRegex2.exec(colBlock)) !== null) {
    expected.add(m[1]);
  }

  for (const col of expected) {
    if (!actual.has(col)) {
      missing.push(col);
    }
  }

  if (missing.length > 0) {
    console.log('');
    console.log('❌ Production schema drift detected!');
    console.log('   The following columns are in schema.ts but missing in Turso:');
    missing.forEach(c => console.log('   - ' + c));
    console.log('');
    console.log('   Run: pnpm exec drizzle-kit push');
    console.log('');
    process.exit(1);
  } else {
    console.log('✅ Production schema is up to date');
  }

  client.close();
}

main().catch(err => {
  console.error('Schema check failed:', err.message);
  process.exit(1);
});
" 2>&1
