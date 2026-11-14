const SHARED_DATABASE_HOST = "news-watch-ponkansh.aws-ap-northeast-1.turso.io";

function isApprovedProductionHost(host) {
  return host === SHARED_DATABASE_HOST;
}

const SHARED_DATABASE_TABLES = new Set([
  "__drizzle_migrations_nordic",
  "answer_logs",
  "assisted_participants",
  "assisted_result_shares",
  "config",
  "discovery_host_metrics",
  "discovery_run",
  "discovery_seen",
  "evidence_signal_observations",
  "exam_answer_assessments",
  "exam_answer_logs",
  "exam_answer_submissions",
  "exam_participants",
  "exam_questions",
  "exam_submission_answers",
  "exam_submission_operations",
  "hatena_feeds",
  "host_gate_state",
  "knowledge",
  "nordic_articles",
  "nordic_job_state",
  "nordic_sources",
  "participant_rate_limits",
  "participant_result_settings",
  "post_publication_kind",
  "post_publications",
  "post_rationales",
  "post_removals",
  "post_retry_queue",
  "post_topics",
  "post_usefulness",
  "post_usefulness_criteria",
  "posts",
  "presentation_entries",
  "presentation_operations",
  "presentation_questions",
  "presentation_reference_settings",
  "presentation_sessions",
  "questions",
  "source_policy",
  "topic_backfill_signatures",
]);

function findUndeclaredTables(actualTables, expectedTables, targetHost) {
  const expectedTableSet = new Set(expectedTables);
  return [...actualTables]
    .filter(
      (table) =>
        !expectedTableSet.has(table) &&
        !table.startsWith("sqlite_") &&
        table !== "__drizzle_migrations",
    )
    .filter((table) => targetHost !== SHARED_DATABASE_HOST || !SHARED_DATABASE_TABLES.has(table))
    .sort();
}

function findMissingColumns(expectedColumnsByTable, actualColumnsByTable) {
  const missing = [];
  for (const [table, expectedColumns] of Object.entries(expectedColumnsByTable)) {
    const actualColumns = actualColumnsByTable[table] ?? new Set();
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) missing.push({ table, column });
    }
  }
  return missing;
}

function readBalancedBlock(source, openIndex) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(openIndex + 1, i);
  }
  throw new Error("Unclosed sqliteTable column block in schema.ts");
}

function parseSchemaColumns(schemaContent) {
  const tables = {};
  const tableRegex = /export const \w+ = sqliteTable\s*\(\s*["']([\w]+)["']\s*,\s*\{/g;
  let match;
  while ((match = tableRegex.exec(schemaContent)) !== null) {
    const openIndex = tableRegex.lastIndex - 1;
    const block = readBalancedBlock(schemaContent, openIndex);
    const columns = new Set();
    const columnRegex = /\b\w+\s*:\s*(?:integer|text|real|blob)\s*\(\s*["']([\w]+)["']/g;
    let columnMatch;
    while ((columnMatch = columnRegex.exec(block)) !== null) columns.add(columnMatch[1]);
    if (columns.size === 0) throw new Error(`No columns parsed for sqliteTable ${match[1]}`);
    tables[match[1]] = columns;
    tableRegex.lastIndex = openIndex + block.length + 2;
  }
  return tables;
}

module.exports = {
  findUndeclaredTables,
  findMissingColumns,
  isApprovedProductionHost,
  parseSchemaColumns,
};
