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
const { findUndeclaredTables } = require("../../scripts/prod-schema-policy.cjs") as {
  findUndeclaredTables: (actual: string[], expected: string[], host: string) => string[];
};

const sharedHost = "news-watch-ponkansh.aws-ap-northeast-1.turso.io";

describe("production schema table policy", () => {
  it("ignores only reviewed shared tables on the designated host", () => {
    const actualTables = [
      "articles",
      "posts",
      "future_table",
      "sqlite_sequence",
      "__drizzle_migrations",
    ];

    expect(findUndeclaredTables(actualTables, ["articles"], sharedHost)).toEqual(["future_table"]);
    expect(findUndeclaredTables(actualTables, ["articles"], "other-db.turso.io")).toEqual([
      "future_table",
      "posts",
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
      expect(readFileSync(capturePath, "utf8")).toContain("findUndeclaredTables");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
