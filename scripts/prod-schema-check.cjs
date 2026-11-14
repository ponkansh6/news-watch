const {
  findUndeclaredTables,
  findMissingColumns,
  isApprovedProductionHost,
  parseSchemaColumns,
} = require("./prod-schema-policy.cjs");

async function checkProductionSchema({ url, authToken, createClient, schemaContent }) {
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
  const targetHost = new URL(url).hostname;
  if (!isApprovedProductionHost(targetHost)) {
    throw new Error("Refusing to check an unapproved production database host");
  }

  const client = createClient({ url, authToken });
  try {
    const expectedColumnsByTable = parseSchemaColumns(schemaContent);
    const expectedTables = Object.keys(expectedColumnsByTable);
    const tablesResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const actualTables = new Set(tablesResult.rows.map((row) => row.name));
    const missingTables = expectedTables.filter((table) => !actualTables.has(table));
    const undeclaredTables = findUndeclaredTables(actualTables, expectedTables, targetHost);

    const actualColumnsByTable = {};
    for (const table of expectedTables) {
      if (!actualTables.has(table)) {
        actualColumnsByTable[table] = new Set();
        continue;
      }
      const quotedTable = `"${table.replaceAll('"', '""')}"`;
      const result = await client.execute(`PRAGMA table_info(${quotedTable})`);
      actualColumnsByTable[table] = new Set(result.rows.map((row) => row.name));
    }

    return {
      missingTables,
      undeclaredTables,
      missingColumns: findMissingColumns(expectedColumnsByTable, actualColumnsByTable),
    };
  } finally {
    await client.close();
  }
}

module.exports = { checkProductionSchema };
