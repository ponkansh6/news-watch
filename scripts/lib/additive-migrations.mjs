import { createClient } from "@libsql/client";

/**
 * @param {string[]} args
 * @returns {string}
 */
export function parseMigrationTagArgument(args) {
  const remaining = [...args];
  if (remaining[0] === "--") remaining.shift();
  if (remaining.length !== 1 || !remaining[0]) {
    throw new Error("usage: pnpm run db:apply-additive -- <journal-migration-tag>");
  }
  return remaining[0];
}

/**
 * Split and validate a Drizzle SQL migration that may only add schema objects.
 * Drizzle writes one statement per breakpoint; accepting any other statement
 * shape would make this guard too permissive, so unknown SQL fails closed.
 *
 * @param {string} sql
 * @returns {Promise<string[]>}
 */
export async function parseAdditiveMigration(sql) {
  const statements = sql.split(/-->\s*statement-breakpoint\s*/i);
  const accepted = [];

  for (const [index, rawStatement] of statements.entries()) {
    const statement = rawStatement
      .replace(/^\s*--[^\n]*(?:\n|$)/gm, "")
      .trim()
      .replace(/;\s*$/, "")
      .trim();

    if (!statement) continue;
    if (statement.includes(";")) {
      throw new Error(`statement ${index + 1} contains multiple SQL statements`);
    }

    const createTablePrefix =
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"\n]+"|`[^`\n]+`|\[[^\]\n]+\]|[\w$]+)/i.test(
        statement,
      );
    const isAddColumn =
      /^ALTER\s+TABLE\s+(?:"[^"\n]+"|`[^`\n]+`|\[[^\]\n]+\]|[\w$]+)\s+ADD(?:\s+COLUMN)?\s+/i.test(
        statement,
      );
    const createIndexPrefix =
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"\n]+"|`[^`\n]+`|\[[^\]\n]+\]|[\w$]+)\s+ON\s+/i.test(
        statement,
      );

    if (!createTablePrefix && !isAddColumn && !createIndexPrefix) {
      const kind = statement.split(/\s+/, 3).join(" ") || "unknown SQL";
      throw new Error(
        `statement ${index + 1} contains unsupported SQL (${kind}); only CREATE TABLE, ALTER TABLE ... ADD COLUMN, and CREATE INDEX are allowed`,
      );
    }

    if (createTablePrefix && !hasCompleteParenthesizedStatement(statement, /^CREATE\s+TABLE\b/i)) {
      throw new Error(`statement ${index + 1} has trailing or incomplete CREATE TABLE syntax`);
    }

    if (createIndexPrefix && !parseSimpleCreateIndex(statement)) {
      throw new Error(`statement ${index + 1} has unsupported or trailing CREATE INDEX syntax`);
    }

    accepted.push(statement);
  }

  if (accepted.length === 0) {
    throw new Error("migration contains no additive SQL statements");
  }

  return validateWithSqliteParser(accepted);
}

function hasCompleteParenthesizedStatement(statement, prefixPattern) {
  if (!prefixPattern.test(statement)) return false;
  const open = statement.indexOf("(");
  if (open < 0) return false;
  const close = findMatchingParenthesis(statement, open);
  return close >= 0 && statement.slice(close + 1).trim() === "";
}

function findMatchingParenthesis(sql, openIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`" || character === "[") {
      quote = character === "[" ? "]" : character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function parseSimpleCreateIndex(statement) {
  const identifier = '(?:"[^"\\n]+"|`[^`\\n]+`|\\[[^\\]\\n]+\\]|[\\w$]+)';
  const pattern = new RegExp(
    `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s+ON\\s+(${identifier})\\s*\\(([^()]*)\\)$`,
    "i",
  );
  return pattern.exec(statement);
}

async function validateWithSqliteParser(statements) {
  const parser = createClient({ url: ":memory:" });
  try {
    for (const statement of statements) {
      const alterMatch = /^ALTER\s+TABLE\s+("[^"\n]+"|`[^`\n]+`|\[[^\]\n]+\]|[\w$]+)/i.exec(
        statement,
      );
      if (alterMatch) {
        await ensureTable(parser, unquoteIdentifier(alterMatch[1]), ["__guard_placeholder"]);
      }

      const indexMatch = parseSimpleCreateIndex(statement);
      if (indexMatch) {
        const tableName = unquoteIdentifier(indexMatch[1]);
        const columns = indexMatch[2].split(",").map((column) => {
          const match = /^("[^"\n]+"|`[^`\n]+`|\[[^\]\n]+\]|[\w$]+)(?:\s+(?:ASC|DESC))?$/i.exec(
            column.trim(),
          );
          if (!match)
            throw new Error("index expressions are not allowed by the additive migration guard");
          return unquoteIdentifier(match[1]);
        });
        await ensureTable(parser, tableName, columns);
      }

      try {
        await parser.execute(statement);
      } catch {
        throw new Error("the SQLite parser rejected a permitted-prefix statement or trailing SQL");
      }
    }

    return statements;
  } finally {
    parser.close();
  }
}

async function ensureTable(client, tableName, columns) {
  const escapedTable = quoteIdentifier(tableName);
  const tableResult = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [tableName],
  });
  if (tableResult.rows.length === 0) {
    const columnSql = [...new Set(columns)].map((column) => `${quoteIdentifier(column)} TEXT`);
    await client.execute(`CREATE TABLE ${escapedTable} (${columnSql.join(", ")})`);
    return;
  }

  const tableInfo = await client.execute(`PRAGMA table_info(${escapedTable})`);
  const existingColumns = new Set(tableInfo.rows.map((row) => row.name));
  for (const column of columns) {
    if (!existingColumns.has(column)) {
      await client.execute(
        `ALTER TABLE ${escapedTable} ADD COLUMN ${quoteIdentifier(column)} TEXT`,
      );
    }
  }
}

function unquoteIdentifier(identifier) {
  if (identifier.startsWith('"')) return identifier.slice(1, -1).replaceAll('""', '"');
  if (identifier.startsWith("`")) return identifier.slice(1, -1).replaceAll("``", "`");
  if (identifier.startsWith("[")) return identifier.slice(1, -1);
  return identifier;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Apply a list of already-validated statements atomically.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string[]} statements
 */
export async function applyAdditiveStatements(client, statements) {
  await client.batch(
    statements.map((sql) => ({ sql })),
    "write",
  );
}
