/**
 * Reproduction test: xtech 20件取得→0件スコアリング
 *
 * 実際のxtech RSSから取得した記事データをフルパイプラインに流し、
 * スコアリングまで正常に完了することを検証する。
 */
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// ── Mock DB (in-memory) ─────────────────────────────────────────────
vi.mock("@/lib/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schemaMod = await import("@/lib/db/schema");
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema: schemaMod });
  return { db, __client: client };
});

// ── Mock embeddings ─────────────────────────────────────────────────
vi.mock("@/lib/embeddings", () => ({
  embedArticle: vi.fn(async () => new Array(768).fill(0.1)),
  embedQuery: vi.fn(async () => new Array(768).fill(0.1)),
  batchEmbed: vi.fn(async (items) => items.map(() => new Array(768).fill(0.1))),
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    if (a.length !== b.length) return 0;
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }),
}));

// ── Mock LLM ─────────────────────────────────────────
const mockScoreArticles = vi.fn();
const mockScoreArticle = vi.fn(async (article: any) => ({
  summary: `個別フォールバック: ${article.title}`,
  usefulness: 8,
  reason: "フォールバックによる個別スコアリング",
}));
vi.mock("@/lib/llm/gemini", () => ({
  scoreArticles: (...args: any[]) => mockScoreArticles(...args),
  scoreArticle: (article: any) => mockScoreArticle(article),
}));

// ── Imports (after mocks) ───────────────────────────────────────────
import * as dbMod from "@/lib/db";
import { getScoredArticles, deleteLowScoredArticles } from "@/lib/db/actions";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import { normalize } from "@/app/api/fetch-news/route";
import {
  calcRecencyScore,
  calcCompositeScore,
  normalizeSimilaritiesWithTagged,
} from "@/lib/scoring";
import type { XtechItem } from "@/lib/news/xtech";
import type { NormalizedArticle } from "@/lib/types";

// ── Realistic xtech fixture data (actual RSS items from 2026-07-23) ──
const XTECH_FIXTURES: XtechItem[] = [
  {
    title: "26年度末開始「SCS評価制度」に脚光　供給網のサイバー対策を客観評価",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301466/",
    description:
      "企業のセキュリティー対策を評価する「SCS評価制度」がサイバーセキュリティー関係者を中心に注目を集めている。",
    date: "2026-07-23T07:06:00+09:00",
  },
  {
    title: "Umiosが販売計画をAIで自動化　時系列基盤モデル採用で精度95％",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301465/",
    description:
      "水産大手のUmiosは2026年6月25日、AIを活用した販売計画の自動作成システムを営業部門で稼働させた。",
    date: "2026-07-23T07:05:00+09:00",
  },
  {
    title: "東急がポイント会員システムを刷新　1年遅れも3年で完遂、内製化へ前進",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301468/",
    description:
      "東急はグループ共通ポイントの会員向けWeb/アプリシステムを刷新した。富士通に外注していた旧システムから内製化を見据えた新システムへ移行した。",
    date: "2026-07-23T07:04:00+09:00",
  },
  {
    title: "ミロク情報が大学のゼミ演習を支援　会計ソフト提供で学生に実務体験を",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301467/",
    description:
      "ミロク情報サービスは同社のクラウド会計ソフトを使ったゼミ演習を多摩大学経営情報学部が開始した。",
    date: "2026-07-23T07:03:00+09:00",
  },
  {
    title: "T＆D系ペット保険会社が基幹系刷新　年間2800時間の業務削減効果",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301469/",
    description: "ペット＆ファミリー損害保険は2026年4月、新基幹システムの本格稼働を開始した。",
    date: "2026-07-23T07:02:00+09:00",
  },
  {
    title: "みずほが中小企業顧客発掘に本腰　「貸してもらえる」AI与信でSMBC追う",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301471/",
    description:
      "みずほ銀行が中堅・中小企業の口座獲得に本腰を入れ始めた。法人向け総合金融サービス「UPSIDER BANK by MIZUHO」を開始した。",
    date: "2026-07-23T07:01:00+09:00",
  },
  {
    title: "JR九州、故障検知システムを構築　車両検査のAIエージェントと一体運用",
    link: "https://xtech.nikkei.com/atcl/nxt/mag/nc/18/020800017/071301470/",
    description:
      "JR九州は2027年3月をメドに、車両からほぼリアルタイムで運行データを取得し故障の兆候を確認するシステムの本格運用を開始する。",
    date: "2026-07-23T07:00:00+09:00",
  },
  {
    title: "ソニーセミコン、スマホ向けイメージセンサーに新構造画素　精細度2割向上",
    link: "https://xtech.nikkei.com/atcl/nxt/column/18/00001/11903/",
    description:
      "ソニーセミコンダクタソリューションズは「RB2×2 OCL」と呼ぶ新構造の画素を搭載したCMOSイメージセンサーを発売した。",
    date: "2026-07-23T05:00:00+09:00",
  },
  {
    title: "JR東日本が「みどりの窓口」で生成AI実証、音声で発券情報を整理",
    link: "https://xtech.nikkei.com/atcl/nxt/column/18/00001/11908/",
    description:
      "JR東日本は「みどりの窓口AI対応サービス」の実現に向けた実証実験の概要を大宮駅で公開した。",
    date: "2026-07-23T05:00:00+09:00",
  },
  {
    title: "AIサーバーは「直流800V」時代へ、グローバル基準と異なる日本　対応急務",
    link: "https://xtech.nikkei.com/atcl/nxt/column/18/03694/072100003/",
    description:
      "米NVIDIAは将来のAIサーバーにおいて直流800Vでの給電を構想している。AIサーバーの電力密度が高まり設備上の限界が近づいている。",
    date: "2026-07-23T05:00:00+09:00",
  },
];

const ARTICLES_WITH_ZENKAKU_COUNT = XTECH_FIXTURES.length;

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

const ARTICLE_COUNT = XTECH_FIXTURES.length; // 10

beforeAll(async () => {
  await (dbMod as any).__client.execute(CREATE_SQL);
});

beforeEach(async () => {
  await (dbMod as any).__client.execute("DELETE FROM articles");
  mockScoreArticles.mockReset();
});

describe("xtech: パイプライン統合（実データフィクスチャ）", () => {
  it("xtech記事をnormalize → tag → score → save → getScoredArticles で取得できる", async () => {
    // ── Step 1: normalize（実際のroute.tsと同じ処理） ──
    const normalized: NormalizedArticle[] = XTECH_FIXTURES.map((a) => normalize(a, "xtech"));

    expect(normalized).toHaveLength(ARTICLE_COUNT);
    expect(normalized[0].sourceId).toBe("xtech");
    expect(normalized[0].sourceName).toBe("日経クロステック");
    expect(normalized[0].title).toContain("SCS評価制度");

    // all titles should be present
    for (const n of normalized) {
      expect(n.title).toBeTruthy();
      expect(n.url).toBeTruthy();
      expect(n.publishedAt).toBeTruthy();
    }

    // ── Step 2: LLMモック（正常系） ──
    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map((item, i) => ({
          summary: `要約: ${item.title.slice(0, 20)}`,
          usefulness: 6 + (i % 4),
          reason: "日経クロステックのIT記事として有用",
        })),
    );

    // ── Step 3: フルパイプライン実行（route.tsの流れを再現） ──
    const since = new Date().toISOString();
    let saved: number | undefined;
    let pipelineError: any;

    try {
      const tagged = await tagArticlesByKeyword(normalized, KEYWORDS);
      saved = await scoreAndSaveTagged(tagged);
      await deleteLowScoredArticles(5, since);
    } catch (err) {
      pipelineError = err;
    }

    // ── Step 4: 検証 ──
    expect(pipelineError).toBeUndefined();
    expect(saved).toBe(ARTICLE_COUNT);

    // ── Step 5: DBからの取得確認 ──
    const scored = await getScoredArticles(100, ["xtech"]);
    expect(scored.length).toBe(ARTICLE_COUNT);

    for (const a of scored) {
      expect(a.score).not.toBeNull();
      expect(a.score).toBeGreaterThan(0);
      expect(a.summary).toBeTruthy();
      expect(a.sourceId).toBe("xtech");
      expect(a.sourceName).toBe("日経クロステック");
    }
  });

  it("descriptionがnullでもパイプラインが正常動作する", async () => {
    const articlesWithNullDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a) => ({
      ...normalize(a, "xtech"),
      description: null,
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "要約テスト",
          usefulness: 7,
          reason: "OK",
        })),
    );

    const tagged = await tagArticlesByKeyword(articlesWithNullDesc, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    expect(saved).toBe(ARTICLE_COUNT);

    const scored = await getScoredArticles(100, ["xtech"]);
    expect(scored.length).toBe(ARTICLE_COUNT);
  });

  it("descriptionが空文字でもパイプラインが正常動作する", async () => {
    const articlesWithEmptyDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a) => ({
      ...normalize(a, "xtech"),
      description: "",
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "要約テスト",
          usefulness: 7,
          reason: "OK",
        })),
    );

    const tagged = await tagArticlesByKeyword(articlesWithEmptyDesc, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    expect(saved).toBe(ARTICLE_COUNT);
  });

  it("xtech特有のタイムゾーン付き日付でもcalcRecencyScoreが正常動作する", async () => {
    const { calcRecencyScore } = await import("@/lib/scoring");

    // 現在時刻に近い日付でテスト（タイムゾーン付きISO 8601）
    const now = new Date();
    const jstDate =
      now.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(" ", "T") + "+09:00";

    const score = calcRecencyScore(jstDate);
    expect(score).toBeGreaterThanOrEqual(8); // within a few days

    // 古い日付
    const oldScore = calcRecencyScore("2026-01-01T00:00:00+09:00");
    expect(oldScore).toBe(0);
  });

  it("descriptionに全角スペースが先頭にあっても正常処理される", async () => {
    const articlesWithZenkakuDesc: NormalizedArticle[] = XTECH_FIXTURES.map((a, i) => ({
      ...normalize(a, "xtech"),
      // 実際のRSSのように先頭に全角スペース
      description: `　${a.description ?? ""}`,
      url: `https://xtech.nikkei.com/test/${i}/unique`,
    }));

    mockScoreArticles.mockImplementation(
      async (items: { title: string; description: string | null }[]) =>
        items.map(() => ({
          summary: "全角スペーステスト",
          usefulness: 6,
          reason: "OK",
        })),
    );

    const tagged = await tagArticlesByKeyword(articlesWithZenkakuDesc, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    expect(saved).toBe(ARTICLES_WITH_ZENKAKU_COUNT);
  });

  it("LLMバッチが全nullを返した場合、savedCount=0（個別フォールバックはscoreArticles内部で処理）", async () => {
    // NOTE: このテストでは @/lib/llm/gemini モジュール全体がモックされているため、
    // scoreArticles 内部のフォールバックロジック（全null→個別スコアリング）は実行されない。
    // 内部フォールバックのテストは tests/lib/llm/gemini.test.ts で実施する。
    mockScoreArticles.mockResolvedValue([null, null]);

    const articles: NormalizedArticle[] = [
      normalize(XTECH_FIXTURES[0], "xtech"),
      normalize(XTECH_FIXTURES[1], "xtech"),
    ];
    articles[0].url = "https://xtech.nikkei.com/fallback/1";
    articles[1].url = "https://xtech.nikkei.com/fallback/2";

    const tagged = articles.map((a) => ({
      article: a,
      embedding: [0.1],
      keyword: null,
      similarity: 0.1,
    }));

    const saved = await scoreAndSaveTagged(tagged);

    // scoreArticlesが全nullを返すと、upsertはされるがsavedCountは0
    expect(saved).toBe(0);
  });
});
