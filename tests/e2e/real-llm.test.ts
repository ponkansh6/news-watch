import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { inArray, gte } from "drizzle-orm";
import { scoreArticles } from "@/lib/llm/gemini";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { KEYWORDS } from "@/lib/config";
import { POST as scoreArticlesRoute } from "@/app/api/score-articles/route";
import { POST as scoringStatusRoute } from "@/app/api/scoring-status/route";
import { POST as fetchNewsRoute } from "@/app/api/fetch-news/route";
import { Client } from "@upstash/qstash";
import { NextRequest } from "next/server";

// Real end-to-end test: hits the REAL Gemini LLM, REAL embeddings API,
// REAL Turso DB, and (Tier E) the REAL QStash publish.
//
// Guardrails:
// - Only runs with RUN_REAL_LLM_E2E=1 AND GOOGLE_API_KEY (no accidental CI cost).
// - Writes to the DB pointed at by TURSO_DATABASE_URL (production per decision).
// - afterEach deletes ONLY the test articles we created (by tracked URL), so we
//   never blanket-delete production rows.

const createdUrls = new Set<string>();
let lastFetchSince: string | null = null;

async function cleanup() {
  if (createdUrls.size === 0) return;
  await db.delete(articles).where(inArray(articles.url, [...createdUrls]));
  createdUrls.clear();
}

describe.skipIf(!process.env.RUN_REAL_LLM_E2E || !process.env.GOOGLE_API_KEY || !process.env.GROQ_API_KEY)(
  "Real LLM E2E Tests (all real services)",
  () => {
    beforeEach(() => {
      // Skip QStash signature verification on direct route calls (localhost
      // cannot receive real QStash delivery).
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      await cleanup();
      // Tier G writes REAL news articles to the DB; remove exactly this run's
      // batch (scoredAt >= the `since` fetch-news returned). Targeted, not a
      // blanket delete.
      if (lastFetchSince) {
        await db.delete(articles).where(gte(articles.scoredAt, lastFetchSince));
        lastFetchSince = null;
      }
    });

    it("Tier A: Single article scoring (real LLM)", async () => {
      const input = [{ title: "Test Title", description: "Test Description" }];
      const results = await scoreArticles(input, "Anthropic");

      expect(results).toHaveLength(1);
      const res = results[0];
      expect(res).not.toBeNull();
      expect(res).toMatchObject({
        summary: expect.any(String),
        relevance: expect.any(Number),
        usefulness: expect.any(Number),
        reason: expect.any(String),
      });
      expect(res!.relevance).toBeGreaterThanOrEqual(0);
      expect(res!.relevance).toBeLessThanOrEqual(10);
    }, 70000);

    it("Tier B: Batch article scoring (real LLM)", async () => {
      const input = [
        { title: "T1", description: "D1" },
        { title: "T2", description: "D2" },
        { title: "T3", description: "D3" },
        { title: "T4", description: "D4" },
      ];
      const results = await scoreArticles(input, "OpenAI");

      expect(results).toHaveLength(4);
      // Real LLM (Groq) may occasionally drop one result in a batch under rate
      // limits; tolerate a single miss but require the batch to mostly succeed.
      const scored = results.filter((r) => r !== null);
      expect(scored.length).toBeGreaterThanOrEqual(3);
      for (const res of scored) {
        expect(res!.summary.length).toBeGreaterThan(0);
      }
    }, 70000);

    it("Tier C: Pipeline integration (real embeddings + LLM + DB)", async () => {
      const raw = [
        {
          title: "Pipeline T1 about Anthropic Claude",
          description: "Pipeline D1 about AI safety research",
          url: "http://test.com/real-c/1",
          urlToImage: null,
          publishedAt: new Date().toISOString(),
          sourceName: "Test",
          sourceId: "test",
          author: "Author",
        },
      ];
      for (const r of raw) createdUrls.add(r.url);

      // Real embeddings + real keyword tagging
      const tagged = await tagArticlesByKeyword(raw, KEYWORDS);
      expect(tagged).toHaveLength(1);
      expect(tagged[0].embedding.length).toBeGreaterThan(0);

      const savedCount = await scoreAndSaveTagged(tagged);
      expect(savedCount).toBe(1);

      const saved = await db
        .select()
        .from(articles)
        .where(inArray(articles.url, raw.map((r) => r.url)));
      expect(saved).toHaveLength(1);
      expect(saved[0].score).not.toBeNull();
      expect(saved[0].summary).not.toBeNull();
      expect(saved[0].embedding).not.toBeNull(); // real embedding persisted
    }, 70000);

    it("Tier D: API Route integration (real embeddings + LLM + DB + polling)", async () => {
      const body = {
        articles: [
          {
            title: "Route T1 about OpenAI GPT",
            description: "Route D1 about large language models",
            url: "http://test.com/real-d/1",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "Route T2 about Softbank investment",
            description: "Route D2 about telecom AI",
            url: "http://test.com/real-d/2",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
        ],
      };
      for (const a of body.articles) createdUrls.add(a.url);

      // Generate `since` BEFORE scoring (mirrors the fixed production flow so
      // scoredAt >= since and polling finds the articles).
      const since = new Date().toISOString();

      const req = new NextRequest("http://localhost/api/score-articles", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const res = await scoreArticlesRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.saved).toBe(2);

      const statusReq = new NextRequest("http://localhost/api/scoring-status", {
        method: "POST",
        body: JSON.stringify({ keywords: [...KEYWORDS], since }),
      });

      const statusRes = await scoringStatusRoute(statusReq);
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      const totalScored = (statusData.status as any[]).reduce(
        (acc, s) => acc + (s.scored || 0),
        0,
      );
      const totalProcessed = (statusData.status as any[]).reduce(
        (acc, s) => acc + (s.processed || 0),
        0,
      );
      expect(totalScored).toBe(2);
      expect(totalProcessed).toBe(2);
    }, 70000);

    it("Tier F: All-keyword scoring completion (real embeddings + LLM + DB + polling)", async () => {
      // One clearly-distinct article per configured keyword so vector tagging
      // assigns each to a different keyword. Verifies scoring-status reports
      // completion for ALL keywords (catches the production "0 scored" bug where
      // polling finds no articles for any keyword).
      const body = {
        articles: [
          {
            title: "Anthropic releases Claude Opus with constitutional AI safety",
            description: "Anthropic researchers publish new alignment methodology for Claude models.",
            url: "http://test.com/real-all/anthropic",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "OpenAI launches GPT-5 and Sora video generation",
            description: "OpenAI unveils new flagship model and video synthesis at its dev conference.",
            url: "http://test.com/real-all/openai",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "Softbank invests $2B in AI data center infrastructure",
            description: "Softbank announces major capital expenditure for AI compute buildout.",
            url: "http://test.com/real-all/softbank",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "KDDI deploys 5G network slicing for enterprise edge AI",
            description: "KDDI expands private 5G and edge computing for manufacturing AI.",
            url: "http://test.com/real-all/kddi",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
          {
            title: "NTT develops photonic neural network accelerator for LLM inference",
            description: "NTT researches optical computing to speed up large language model inference.",
            url: "http://test.com/real-all/ntt",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
        ],
      };
      for (const a of body.articles) createdUrls.add(a.url);

      // Generate `since` BEFORE scoring (mirrors the fixed production flow).
      const since = new Date().toISOString();

      const req = new NextRequest("http://localhost/api/score-articles", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await scoreArticlesRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.saved).toBe(KEYWORDS.length);

      const statusReq = new NextRequest("http://localhost/api/scoring-status", {
        method: "POST",
        body: JSON.stringify({ keywords: [...KEYWORDS], since }),
      });
      const statusRes = await scoringStatusRoute(statusReq);
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();

      // Every configured keyword must have been processed and scored.
      for (const kw of KEYWORDS) {
        const entry = (statusData.status as any[]).find((s) => s.keyword === kw);
        expect(entry, `keyword "${kw}" missing from scoring-status`).toBeTruthy();
        expect(entry.processed, `keyword "${kw}" not processed`).toBeGreaterThanOrEqual(1);
        expect(entry.scored, `keyword "${kw}" not scored`).toBeGreaterThanOrEqual(1);
      }
    }, 70000);

    it.skipIf(!process.env.QSTASH_TOKEN)(
      "Tier E: Real QStash publish + direct route delivery",
      async () => {
        const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
        const scoreUrl =
          process.env.SCORE_URL ?? "https://news-watch.vercel.app/api/score-articles";
        const payloadArticles = [
          {
            title: "QStash T1 about NTT network AI",
            description: "QStash D1 about infrastructure",
            url: "http://test.com/real-e/1",
            urlToImage: null,
            publishedAt: new Date().toISOString(),
            sourceName: "Test",
            sourceId: "test",
            author: "Author",
          },
        ];
        for (const a of payloadArticles) createdUrls.add(a.url);

        // Real publish to QStash (enqueue)
        const published = await qstash.publishJSON({
          url: scoreUrl,
          body: { articles: payloadArticles },
          retries: 3,
        });
        expect(published.messageId).toBeTruthy();

        // Simulate QStash delivery: call the route directly (localhost cannot
        // receive real QStash delivery).
        const req = new NextRequest("http://localhost/api/score-articles", {
          method: "POST",
          body: JSON.stringify({ articles: payloadArticles }),
        });
        const res = await scoreArticlesRoute(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.saved).toBe(1);
      },
      70000,
    );

    it.skipIf(Boolean(process.env.QSTASH_TOKEN))(
      "Tier G: Full production flow via real fetch-news (all sources, real news APIs)",
      async () => {
        // Dev inline mode (NODE_ENV=development, no QSTASH_TOKEN): fetch-news
        // fetches REAL top-headlines from every source and scores inline with
        // REAL embeddings + REAL LLM, saving to the REAL DB. This reproduces the
        // production flow and surfaces the "0 fetched" bug when news API keys
        // are missing/invalid.
        const req = new NextRequest("http://localhost/api/fetch-news", {
          method: "POST",
          body: JSON.stringify({
            sources: [
              "gnews",
              "newsapi",
              "hackernews",
              "qiita",
              "github",
              "yamadashy",
              "itmedia",
              "codezine",
            ],
          }),
          headers: { "Content-Type": "application/json" },
        });
        const res = await fetchNewsRoute(req);
        const data = await res.json();
        expect(res.status).toBe(200);

        // Per-source breakdown: shows exactly which sources succeeded/failed.
        const perSource = (data.perSource as any[]) ?? [];
        console.log(`[Tier G] per-source fetched:`, perSource);
        // At least one source must have returned articles (catches the
        // production "all sources 0" failure).
        expect(
          perSource.some((p) => (p.fetched || 0) > 0),
          `all news sources returned 0 articles (perSource=${JSON.stringify(perSource)})`,
        ).toBe(true);

        const totalFetched = (data.results as any[]).reduce(
          (acc: number, r: any) => acc + (r.fetched || 0),
          0,
        );
        // Surfaces the production "0 fetched" bug (news API keys missing/invalid
        // -> every source returns [] -> nothing queued/scored).
        expect(totalFetched).toBeGreaterThan(0);

        lastFetchSince = (data.since as string) || null;

        const statusReq = new NextRequest("http://localhost/api/scoring-status", {
          method: "POST",
          body: JSON.stringify({ keywords: [...KEYWORDS], since: lastFetchSince }),
        });
        const statusRes = await scoringStatusRoute(statusReq);
        expect(statusRes.status).toBe(200);
        const statusData = await statusRes.json();

        const totalProcessed = (statusData.status as any[]).reduce(
          (acc: number, s: any) => acc + (s.processed || 0),
          0,
        );
        const totalScored = (statusData.status as any[]).reduce(
          (acc: number, s: any) => acc + (s.scored || 0),
          0,
        );

        // Every fetched article was processed (kept; low-score deletion protects
        // the current batch via scoredAt >= since) and the run completed.
        expect(totalProcessed).toBe(totalFetched);
        expect(totalScored).toBeGreaterThan(0);

        // Not all keywords are 0: at least one keyword was scored (guards
        // against the production "all keywords 0 scored" symptom).
        const anyKeywordScored = (statusData.status as any[]).some(
          (s) => (s.scored || 0) > 0,
        );
        expect(
          anyKeywordScored,
          `all keywords scored 0 (status=${JSON.stringify(statusData.status)})`,
        ).toBe(true);
      },
      120000,
    );
  },
);
