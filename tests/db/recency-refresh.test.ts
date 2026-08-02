/**
 * Recency Delta Refresh テスト
 *
 * refreshRecencyForSources は fetch-news 実行時に selectedSources に含まれる
 * sourceId の全記事（今回 fetch されたもの以外）について recency を再計算し、
 * score を差分更新する。
 *
 * 検証項目:
 * - recency が現在時刻基準で再計算される
 * - score が delta = (newRecency - oldRecency) * 0.3 で更新される
 * - score は 0-10 にクランプされる
 * - similarity / usefulness は変更されない
 * - recencyRefreshedAt が更新される
 * - score=null の記事はスキップされる
 * - excludeUrls に含まれる記事はスキップされる
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

// インメモリ client をモック
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  return { ...actual, __client: (actual as any).db.$client };
});

import * as dbMod from "@/lib/db";
const dbClient = (dbMod as any).__client as Awaited<ReturnType<typeof createClient>>;

import { upsertArticle, refreshRecencyForSources } from "../../src/lib/db";

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    url_to_image TEXT,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_id TEXT,
    author TEXT,
    keyword TEXT,
    summary TEXT,
    relevance REAL,
    usefulness REAL,
    recency REAL,
    recency_refreshed_at TEXT,
    reason TEXT,
    scored_at TEXT,
    score REAL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
`;

// Helper to insert an article directly
async function insertRawArticle(overrides: Record<string, any> = {}) {
  const defaults = {
    title: "test article",
    description: null,
    url: `https://example.com/article-${Date.now()}-${Math.random()}`,
    url_to_image: null,
    published_at: "2026-07-27T00:00:00Z",
    source_name: "test",
    source_id: "zenn",
    author: null,
    keyword: "TypeScript",
    summary: "要約",
    relevance: 5.0,
    usefulness: 7.0,
    recency: 10.0,
    recency_refreshed_at: null,
    reason: "test reason",
    scored_at: "2026-07-27T00:00:00Z",
    score: 8.0,
    embedding: null,
    created_at: "2026-07-27T00:00:00Z",
  };
  const values = { ...defaults, ...overrides };
  const columns = Object.keys(values).join(", ");
  const placeholders = Object.keys(values)
    .map(() => "?")
    .join(", ");
  await dbClient.execute(
    `INSERT INTO articles (${columns}) VALUES (${placeholders})`,
    Object.values(values),
  );
}

describe("refreshRecencyForSources", () => {
  beforeAll(async () => {
    await dbClient.execute(CREATE_SQL);
  });

  beforeEach(async () => {
    await dbClient.execute("DELETE FROM articles");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("対象sourceIdの記事のrecencyとscoreを更新する", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    // published_at = 5日前 → old recency は 10（単体テストで確認済みの値だが、
    // 初期値として 8 を設定しておく）
    await insertRawArticle({
      url: "https://example.com/article-1",
      source_id: "zenn",
      published_at: new Date(NOW - 5 * 86400 * 1000).toISOString(),
      recency: 8, // 前回のスコアリング時には 8 だった
      score: 7.0,
    });

    const updatedCount = await refreshRecencyForSources(["zenn"], []);

    expect(updatedCount).toBe(1);

    // 記事を読み直して確認
    const rows = await dbClient.execute(
      "SELECT * FROM articles WHERE url = 'https://example.com/article-1'",
    );
    const row = rows.rows[0] as any;

    // published_at は 5日前 → tier は 7日以内 → recency = 6
    expect(row.recency).toBe(6);

    // delta = (6 - 8) * 0.3 = -0.6
    // newScore = round(max(0, min(10, 7.0 + (-0.6))) * 10) / 10 = round(6.4 * 10) / 10 = 6.4
    expect(row.score).toBe(6.4);

    // recencyRefreshedAt が設定されていること
    expect(row.recency_refreshed_at).toBeTruthy();
  });

  it("scoreが0以下にクランプされる", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    // 古い記事: published_at は60日前, recency=10(だった), score=1.0
    // 新recency=0, delta = (0-10)*0.3 = -3.0, newScore = max(0, 1.0-3.0) = 0
    await insertRawArticle({
      url: "https://example.com/old-article",
      source_id: "zenn",
      published_at: new Date(NOW - 60 * 86400 * 1000).toISOString(),
      recency: 10,
      score: 1.0,
    });

    await refreshRecencyForSources(["zenn"], []);

    const rows = await dbClient.execute(
      "SELECT * FROM articles WHERE url = 'https://example.com/old-article'",
    );
    const row = rows.rows[0] as any;
    expect(row.score).toBe(0);
    expect(row.recency).toBe(0);
  });

  it("scoreが10を超えてクランプされる", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    // published_at は今日, old recency=0, score=9.5
    // new recency=10, delta=(10-0)*0.3=3.0, newScore=min(10, 9.5+3.0)=10
    await insertRawArticle({
      url: "https://example.com/new-article",
      source_id: "zenn",
      published_at: new Date(NOW).toISOString(),
      recency: 0,
      score: 9.5,
    });

    await refreshRecencyForSources(["zenn"], []);

    const rows = await dbClient.execute(
      "SELECT * FROM articles WHERE url = 'https://example.com/new-article'",
    );
    const row = rows.rows[0] as any;
    expect(row.score).toBe(10);
    expect(row.recency).toBe(10);
  });

  it("score=nullの記事はスキップされる", async () => {
    await insertRawArticle({
      url: "https://example.com/no-score",
      source_id: "zenn",
      score: null,
      recency: 5,
    });

    const updatedCount = await refreshRecencyForSources(["zenn"], []);

    expect(updatedCount).toBe(0);

    // score が null のまま変わっていないことを確認
    const rows = await dbClient.execute(
      "SELECT * FROM articles WHERE url = 'https://example.com/no-score'",
    );
    const row = rows.rows[0] as any;
    expect(row.score).toBeNull();
    expect(row.recency).toBe(5); // unchanged
  });

  it("excludeUrlsに含まれる記事はスキップされる", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    // 5日前の記事: 新recency=6 になるので、old recency=8 から変化する
    const pubDate = new Date(NOW - 5 * 86400 * 1000).toISOString();
    await insertRawArticle({
      url: "https://example.com/excluded",
      source_id: "zenn",
      published_at: pubDate,
      score: 8.0,
      recency: 8,
    });
    await insertRawArticle({
      url: "https://example.com/included",
      source_id: "zenn",
      published_at: pubDate,
      score: 8.0,
      recency: 8,
    });

    const updatedCount = await refreshRecencyForSources(["zenn"], ["https://example.com/excluded"]);

    expect(updatedCount).toBe(1);

    // excluded の記事は更新されていない
    const excludedRow = (
      await dbClient.execute("SELECT * FROM articles WHERE url = 'https://example.com/excluded'")
    ).rows[0] as any;
    expect(excludedRow.recency).toBe(8); // unchanged
    expect(excludedRow.recency_refreshed_at).toBeNull();

    // included の記事は更新されている
    const includedRow = (
      await dbClient.execute("SELECT * FROM articles WHERE url = 'https://example.com/included'")
    ).rows[0] as any;
    expect(includedRow.recency).toBe(6); // updated
    expect(includedRow.recency_refreshed_at).toBeTruthy();
  });

  it("異なるsourceIdの記事は更新されない", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    await insertRawArticle({
      url: "https://example.com/other-source",
      source_id: "qiita",
      score: 8.0,
      recency: 10,
    });

    // zenn のみ指定 → qiita の記事は更新されない
    const updatedCount = await refreshRecencyForSources(["zenn"], []);
    expect(updatedCount).toBe(0);

    const row = (
      await dbClient.execute(
        "SELECT * FROM articles WHERE url = 'https://example.com/other-source'",
      )
    ).rows[0] as any;
    expect(row.recency).toBe(10);
  });

  it("similarity/relevance/usefulnessは変更されない", async () => {
    const NOW = new Date("2026-07-27T12:00:00Z").getTime();
    vi.setSystemTime(NOW);

    await insertRawArticle({
      url: "https://example.com/immutable",
      source_id: "zenn",
      relevance: 3.5,
      usefulness: 6.2,
      score: 8.0,
      recency: 10,
    });

    await refreshRecencyForSources(["zenn"], []);

    const row = (
      await dbClient.execute("SELECT * FROM articles WHERE url = 'https://example.com/immutable'")
    ).rows[0] as any;
    expect(row.relevance).toBe(3.5);
    expect(row.usefulness).toBe(6.2);
  });
});
