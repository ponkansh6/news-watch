import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkProductionSchema } = require("../../scripts/prod-schema-check.cjs") as {
  checkProductionSchema: (options: {
    url: string;
    authToken: string;
    createClient: (options: { url: string; authToken: string }) => {
      execute: (sql: string) => Promise<{ rows: { name: string }[] }>;
      close: () => Promise<void> | void;
    };
    schemaContent: string;
  }) => Promise<{
    missingTables: string[];
    undeclaredTables: string[];
    missingColumns: { table: string; column: string }[];
  }>;
};
const { findUndeclaredTables, findMissingColumns, isApprovedProductionHost, parseSchemaColumns } =
  require("../../scripts/prod-schema-policy.cjs") as {
    findUndeclaredTables: (actual: string[], expected: string[], host: string) => string[];
    findMissingColumns: (
      expected: Record<string, Set<string>>,
      actual: Record<string, Set<string>>,
    ) => { table: string; column: string }[];
    isApprovedProductionHost: (host: string) => boolean;
    parseSchemaColumns: (source: string) => Record<string, Set<string>>;
  };

const sharedHost = "news-watch-ponkansh.aws-ap-northeast-1.turso.io";

describe("production schema table policy", () => {
  it("requires production schema verification on every normal push", () => {
    const hook = readFileSync(path.resolve(__dirname, "../../.husky/pre-push"), "utf8");
    expect(hook).toContain("NEED_TEST=0; NEED_SMOKE=0; NEED_DRIFT=1");
    expect(hook).toContain("Turso credentials are required for production schema verification");
    expect(hook).toContain("bash scripts/check-prod-schema.sh");
    expect(hook).toContain("本番スキーマ検査に失敗しました。push を中止します。");
  });

  it("accepts only the configured production database host", () => {
    expect(isApprovedProductionHost(sharedHost)).toBe(true);
    expect(isApprovedProductionHost("other-db.turso.io")).toBe(false);
  });

  it("parses every sqliteTable column, including blocks with nested braces", () => {
    const columns = parseSchemaColumns(`
      export const first = sqliteTable("first_table", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        createdAt: text("created_at").$defaultFn(() => ({ value: "}" })),
      }, (table) => ({ idx: index("idx_first").on(table.id) }));
      export const second = sqliteTable("second_table", {
        ownerId: text("owner_id").notNull(),
      });
    `);

    expect(
      Object.fromEntries(Object.entries(columns).map(([table, cols]) => [table, [...cols]])),
    ).toEqual({
      first_table: ["id", "created_at"],
      second_table: ["owner_id"],
    });
  });

  it("reports missing columns across all tables with table-qualified names", () => {
    expect(
      findMissingColumns(
        { articles: new Set(["id", "url"]), gemini_request_attempts: new Set(["lease_kind"]) },
        { articles: new Set(["id"]), gemini_request_attempts: new Set() },
      ),
    ).toEqual([
      { table: "articles", column: "url" },
      { table: "gemini_request_attempts", column: "lease_kind" },
    ]);
  });

  it("ignores only reviewed shared tables on the designated host", () => {
    const actualTables = [
      "articles",
      "posts",
      "future_table",
      "presentation_reference_settings",
      "sqlite_sequence",
      "__drizzle_migrations",
    ];

    expect(findUndeclaredTables(actualTables, ["articles"], sharedHost)).toEqual(["future_table"]);
    expect(findUndeclaredTables(actualTables, ["articles"], "other-db.turso.io")).toEqual([
      "future_table",
      "posts",
      "presentation_reference_settings",
    ]);
  });

  it("uses a quoted heredoc so embedded JavaScript is not evaluated by the shell", () => {
    const projectRoot = path.resolve(__dirname, "../..");
    const script = readFileSync(path.join(projectRoot, "scripts/check-prod-schema.sh"), "utf8");
    expect(script).toMatch(/node\s+<<'NODE'/);

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "prod-schema-heredoc-"));
    try {
      const binDir = path.join(tempRoot, "bin");
      const markerPath = path.join(tempRoot, "expanded");
      const nodePath = path.join(binDir, "node");
      const pnpmPath = path.join(binDir, "pnpm");
      const capturePath = path.join(tempRoot, "stdin");
      const env = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PROJECT_ROOT: projectRoot,
      };

      // The node stub consumes the heredoc without making a database connection.
      mkdirSync(binDir);
      writeFileSync(nodePath, `#!/bin/sh\ncat > '${capturePath}'\n`);
      writeFileSync(pnpmPath, `#!/bin/sh\nprintf executed > '${markerPath}'\n`);
      chmodSync(nodePath, 0o755);
      chmodSync(pnpmPath, 0o755);

      execFileSync("sh", [path.join(projectRoot, "scripts/check-prod-schema.sh")], {
        env: {
          ...env,
          TURSO_DATABASE_URL: "libsql://local.invalid",
          TURSO_AUTH_TOKEN: "test-token",
        },
        stdio: "ignore",
      });

      expect(existsSync(markerPath)).toBe(false);
      expect(readFileSync(capturePath, "utf8")).toContain("checkProductionSchema");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when production credentials are missing", () => {
    const projectRoot = path.resolve(__dirname, "../..");
    try {
      execFileSync("sh", [path.join(projectRoot, "scripts/check-prod-schema.sh")], {
        env: {
          ...process.env,
          TURSO_DATABASE_URL: "",
          TURSO_AUTH_TOKEN: "",
        },
        stdio: "pipe",
      });
      throw new Error("expected missing credentials to fail");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(1);
    }
  });

  it("checks every table column against a mocked Turso database", async () => {
    const result = await checkSchemaWithMock({
      missingColumn: "gemini_request_attempts.lease_kind",
    });
    expect(result.missingColumns).toContainEqual({
      table: "gemini_request_attempts",
      column: "lease_kind",
    });
    expect(result.pragmas).toContain('PRAGMA table_info("gemini_request_attempts")');
    expect(result.pragmas).toHaveLength(
      Object.keys(parseSchemaColumns(result.schemaContent)).length,
    );
  });

  it("fails when the Turso connection cannot be established", async () => {
    await expect(checkSchemaWithMock({ connectionError: true })).rejects.toThrow(
      "simulated Turso connection failure",
    );
  });
});

async function checkSchemaWithMock(options: {
  missingColumn?: string;
  connectionError?: boolean;
}): Promise<{
  schemaContent: string;
  missingTables: string[];
  undeclaredTables: string[];
  missingColumns: { table: string; column: string }[];
  pragmas: string[];
}> {
  const projectRoot = path.resolve(__dirname, "../..");
  const schemaPath = path.join(projectRoot, "src/lib/db/schema.ts");
  const schemaContent = readFileSync(schemaPath, "utf8");
  const columns = parseSchemaColumns(schemaContent);
  const pragmas: string[] = [];
  const result = await checkProductionSchema({
    url: `libsql://${sharedHost}`,
    authToken: "mock-token",
    schemaContent,
    createClient: () => {
      if (options.connectionError) throw new Error("simulated Turso connection failure");
      return {
        execute: async (sql) => {
          if (sql.includes("sqlite_master")) {
            return { rows: Object.keys(columns).map((name) => ({ name })) };
          }
          pragmas.push(sql);
          const table = sql.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
          const tableColumns = [...(columns[table ?? ""] ?? [])]
            .filter((column) => options.missingColumn !== `${table}.${column}`)
            .map((name) => ({ name }));
          return { rows: tableColumns };
        },
        close: () => {},
      };
    },
  });
  return { ...result, schemaContent, pragmas };
}
