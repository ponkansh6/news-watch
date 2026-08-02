import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Edge runtime 互換性の再発防止テスト。
 *
 * 背景: エッジランタイム（Next.js middleware）で Node.js ビルトインモジュール
 * （例: `import { timingSafeEqual } from "crypto"`）を import すると、
 * 本番環境（Vercel）で `/admin/*` が 500 になる。
 *   https://nextjs.org/docs/messages/node-module-in-edge-runtime
 *
 * 挙動テスト（tests/middleware.test.ts）は Node 環境で実行されるため
 * この種のバグを検出できない（Node では crypto が import できるため）。
 * そのため、エッジランタイムで実行されるファイルを静的解析し、
 * Node ビルトインモジュールの import と `Buffer` グローバルの使用を禁止する。
 */

const SRC_DIR = path.join(process.cwd(), "src");

// エッジランタイムで利用できない Node.js ビルトインモジュール。
const BANNED_NODE_MODULES = new Set([
  "crypto",
  "fs",
  "path",
  "os",
  "http",
  "https",
  "http2",
  "stream",
  "zlib",
  "child_process",
  "worker_threads",
  "net",
  "tls",
  "dgram",
  "dns",
  "readline",
  "tty",
  "v8",
  "cluster",
  "repl",
  "perf_hooks",
]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function isEdgeRuntimeFile(relPath: string, source: string): boolean {
  // Next.js middleware は常にエッジランタイムで実行される。
  if (relPath === "middleware.ts" || relPath === "middleware.tsx") {
    return true;
  }
  // Route handler 等は `export const runtime = "edge"` でオプトインする。
  return /\bruntime\s*=\s*["']edge["']/.test(source);
}

interface EdgeFile {
  relPath: string;
  source: string;
}

function findEdgeFiles(): EdgeFile[] {
  return walk(SRC_DIR)
    .map((file) => ({
      relPath: path.relative(SRC_DIR, file),
      source: readFileSync(file, "utf-8"),
    }))
    .filter(({ relPath, source }) => isEdgeRuntimeFile(relPath, source));
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromPattern = /from\s+["']([^"']+)["']/g;
  const dynamicPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(fromPattern)) {
    specifiers.push(m[1]);
  }
  for (const m of source.matchAll(dynamicPattern)) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

describe("edge runtime compatibility", () => {
  const edgeFiles = findEdgeFiles();

  it("エッジランタイム対象ファイルを検出できる（middleware が存在する）", () => {
    expect(edgeFiles.length).toBeGreaterThan(0);
  });

  for (const { relPath, source } of edgeFiles) {
    it(`${relPath} は Node.js ビルトインモジュールを import しない`, () => {
      const offenders = collectImportSpecifiers(source).filter((spec) => {
        if (spec.startsWith("node:")) {
          return true;
        }
        return BANNED_NODE_MODULES.has(spec.split("/")[0]);
      });

      expect(offenders).toEqual([]);
    });

    it(`${relPath} は Node 専用の Buffer グローバルを使用しない`, () => {
      expect(source).not.toMatch(/\bBuffer\b/);
    });
  }
});
