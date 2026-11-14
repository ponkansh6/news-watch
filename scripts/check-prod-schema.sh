#!/bin/sh
# Check that the production Turso DB schema matches schema.ts.
# Read-only — does not modify the database.
# Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... scripts/check-prod-schema.sh

set -e

if [ -z "$TURSO_DATABASE_URL" ] || [ -z "$TURSO_AUTH_TOKEN" ]; then
  echo "❌ Production schema check requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN" >&2
  exit 1
fi

echo "🔍 Checking production schema consistency..."

# Run a small Node.js script that uses @libsql/client to compare schemas
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
export PROJECT_ROOT
node <<'NODE'
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');
const { checkProductionSchema } = require(path.join(process.env.PROJECT_ROOT, 'scripts/prod-schema-check.cjs'));

async function main() {
  const schemaPath = path.join(process.env.PROJECT_ROOT, 'src/lib/db/schema.ts');
  const result = await checkProductionSchema({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    createClient,
    schemaContent: fs.readFileSync(schemaPath, 'utf-8'),
  });

  if (result.missingTables.length || result.undeclaredTables.length || result.missingColumns.length) {
    console.log('');
    console.log('❌ Production schema drift detected!');
    if (result.missingTables.length) {
      console.log('   The following tables are defined in schema.ts but missing in Turso:');
      result.missingTables.forEach((table) => console.log('   - ' + table));
    }
    if (result.missingColumns.length) {
      console.log('   The following columns are defined in schema.ts but missing in Turso:');
      result.missingColumns.forEach(({ table, column }) => console.log(`   - ${table}.${column}`));
    }
    if (result.undeclaredTables.length) {
      console.log('   The following Turso tables are not declared in schema.ts:');
      result.undeclaredTables.forEach((table) => console.log('   - ' + table));
      console.log('   `drizzle-kit push` may propose dropping these tables. Do not use it.');
    }
    console.log('');
    console.log('   Review the database target and create an explicit SQL migration with `pnpm run db:generate`.');
    console.log('   If migration history matches, `pnpm run db:migrate` applies reviewed additive migrations.');
    console.log('   For a divergent ledger, apply only one reviewed additive migration with `pnpm run db:apply-additive -- <tag>`.');
    console.log('   That command does not rewrite the shared migration ledger.');
    console.log('');
    process.exitCode = 1;
    return;
  }

  console.log('✅ Production schema is up to date');
}

main().catch((err) => {
  console.error('Schema check failed:', err.message);
  process.exitCode = 1;
});
NODE
