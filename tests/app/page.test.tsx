// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../lib/test-utils";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RefreshProvider } from "../../src/app/refresh-context";
import "@testing-library/jest-dom/vitest";

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mockCookieGet,
    set: mockCookieSet,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal<Record<string, any>>()) as Record<string, any>;
  return { ...actual, getScoredArticlesCached: vi.fn(async () => []) };
});

import Home from "../../src/app/page";

async function renderHome(searchParams: Record<string, string> = {}) {
  // RSC コンポーネントを直接呼び出して ReactNode を得てから render する
  const element = await Home({ searchParams: Promise.resolve(searchParams) });
  return render(<RefreshProvider>{element}</RefreshProvider>);
}

describe("Home (RSC page) — レンダリング中の cookie 書き込み禁止", () => {
  beforeEach(() => {
    mockCookieGet.mockReset();
    mockCookieSet.mockReset();
    mockCookieGet.mockReturnValue(undefined);
  });

  it("RSC レンダリング中に cookie を書き込まない（?source なし・cookie なし）", async () => {
    await renderHome();
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("URL パラメータが保存済み cookie と異なる場合も cookie を書き込まない", async () => {
    mockCookieGet.mockReturnValue({ value: "zenn" });
    await renderHome({ source: "qiita" });
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("?source パラメータ優先でソースを解決する", async () => {
    mockCookieGet.mockReturnValue({ value: "zenn" });
    await renderHome({ source: "qiita" });
    expect(screen.getByRole("combobox")).toHaveValue("qiita");
  });

  it("cookie 保存済みならそれを表示する", async () => {
    mockCookieGet.mockReturnValue({ value: "qiita" });
    await renderHome();
    expect(screen.getByRole("combobox")).toHaveValue("qiita");
  });

  it("cookie も ?source も無ければ zenn を表示する", async () => {
    await renderHome();
    expect(screen.getByRole("combobox")).toHaveValue("zenn");
  });
});

describe("page.tsx 静的ガード — 'use server' 再混入防止", () => {
  it("src/app/page.tsx に 'use server' ディレクティブが存在しない", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf-8");
    expect(source).not.toContain('"use server"');
  });
});
