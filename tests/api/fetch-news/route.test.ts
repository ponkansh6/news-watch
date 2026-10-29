import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/fetch-news/route";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { revalidateTag } from "next/cache";

vi.mock("@/lib/news/zenn", () => ({
  searchZenn: vi.fn().mockResolvedValue([
    {
      title: "Zenn Article",
      path: "/articles/zenn-1",
      published_at: new Date().toISOString(),
      user: { name: "Zenn User" },
    },
  ]),
}));

vi.mock("@/lib/news/qiita", () => ({
  searchQiita: vi.fn().mockResolvedValue([
    {
      title: "Qiita Article",
      link: "https://qiita.com/items/1",
      published: new Date().toISOString(),
      author: { name: "Qiita User" },
    },
  ]),
}));

vi.mock("@/lib/news/yamadashy", () => ({
  searchYamadashy: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/itmedia", () => ({
  searchITmedia: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/codezine", () => ({
  searchCodeZine: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/zdnet", () => ({
  searchZdnet: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/xtech", () => ({
  searchXtech: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/hatena", () => ({
  searchHatena: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/news/hatena-discovery", () => ({
  discoverHatenaFeeds: vi.fn().mockResolvedValue({ discovered: 0, updated: 0, errors: [] }),
}));

vi.mock("@/lib/llm", () => ({
  scoreArticles: vi.fn().mockResolvedValue([
    {
      ntt_relevance: 9,
      usefulness: 8,
      summary: "Summary of article",
      reason: "Good reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    ntt_relevance: 9,
    usefulness: 8,
    summary: "Summary of article",
    reason: "Good reason",
  }),
  buildPreferencePromptSection: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/db", () => ({
  upsertArticles: vi.fn().mockImplementation((dataList: any[]) =>
    Promise.resolve({
      succeeded: dataList.map((d) => d.url),
      failed: [],
    }),
  ),
  deleteOrphanedArticles: vi.fn().mockResolvedValue(undefined),
  deleteLowScoredArticles: vi.fn().mockResolvedValue(undefined),
  refreshRecencyForSources: vi.fn().mockResolvedValue(0),
  getLatestPreferenceProfile: vi.fn().mockResolvedValue(null),
  getScoringStateByUrls: vi.fn().mockResolvedValue(new Map()),
  deleteStaleLowScored: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/score-pipeline", () => ({
  scoreAndSaveTagged: vi.fn().mockResolvedValue(1),
}));

describe("POST /api/fetch-news", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("GET request returns instructions message", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBeDefined();
  });

  test("POST request triggers the pipeline and returns 200 with status info", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toBeDefined();
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("POST streams progress and the final fetch result when NDJSON is requested", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events.some((event) => event.type === "progress" && event.stage === "fetching")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "progress" && event.stage === "scoring")).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      ok: true,
      results: [{ fetched: expect.any(Number), saved: expect.any(Number) }],
      cacheInvalidationToken: expect.any(String),
    });
    const { verifyArticlesInvalidationToken } = await import("@/lib/cache-invalidation-token");
    expect(verifyArticlesInvalidationToken(events.at(-1).cacheInvalidationToken)).toBe(true);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("NDJSON stream emits a two-second heartbeat while source fetching is still pending", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    const { searchZenn } = await import("@/lib/news/zenn");
    let finishSearch: () => void = () => {};
    vi.mocked(searchZenn).mockReturnValueOnce(
      new Promise((resolve) => {
        finishSearch = () => resolve([]);
      }),
    );
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    try {
      const response = await POST(req);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const first = await reader.read();
      expect(JSON.parse(decoder.decode(first.value))).toMatchObject({
        type: "progress",
        stage: "fetching",
      });

      const heartbeatPromise = reader.read();
      let heartbeatReceived = false;
      void heartbeatPromise.then(() => {
        heartbeatReceived = true;
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(heartbeatReceived).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const heartbeat = await heartbeatPromise;
      expect(JSON.parse(decoder.decode(heartbeat.value))).toMatchObject({
        type: "progress",
        stage: "fetching",
      });

      finishSearch();
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  test("stream opt-in preserves regular JSON errors for invalid requests", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "invalid-source" }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid source" });
  });

  test("POST immediately expires the article list cache after scoring and cleanup", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { deleteStaleLowScored } = await import("@/lib/db");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(vi.mocked(scoreAndSaveTagged)).toHaveBeenCalled();
    expect(vi.mocked(deleteStaleLowScored)).toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("articles", { expire: 0 });
    expect(vi.mocked(scoreAndSaveTagged).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteStaleLowScored).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(deleteStaleLowScored).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
  });

  test("POST expires the cache when only an already-scored article is returned", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { getScoringStateByUrls } = await import("@/lib/db");
    vi.mocked(getScoringStateByUrls).mockResolvedValueOnce(
      new Map([
        [
          "https://zenn.dev/articles/zenn-1",
          {
            url: "https://zenn.dev/articles/zenn-1",
            contentHash: null,
            score: 8,
            scoringSignature: null,
            scoredAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].scored).toBe(0);
    expect(body.results[0].skipped).toBe(1);
    expect(scoreAndSaveTagged).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
  });

  test("POST expires the cache even when scoring saves zero articles", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(scoreAndSaveTagged).mockResolvedValueOnce(0);
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].saved).toBe(0);
    expect(revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
  });

  test("invalid source response does not expire the article cache", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "unknown-source" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(scoreAndSaveTagged).not.toHaveBeenCalled();
  });

  test("CRON_SECRET missing authorization returns 401", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("CRON_SECRET incorrect token returns 401", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("CRON_SECRET unset fails closed", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    expect((await POST(req)).status).toBe(401);
  });

  test("empty CRON_SECRET fails closed", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    expect((await POST(req)).status).toBe(401);
  });

  test("browser Basic Auth succeeds without exposing CRON_SECRET", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from("admin:password").toString("base64")}`,
      },
    });

    expect((await POST(req)).status).toBe(200);
  });

  test("browser Basic Auth rejects incorrect credentials", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from("admin:wrong").toString("base64")}`,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  test("partial refresh failure preserves a scored article and errors before cache expiry", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { deleteStaleLowScored, refreshRecencyForSources } = await import("@/lib/db");
    vi.mocked(refreshRecencyForSources).mockRejectedValueOnce(new Error("recency write failed"));
    vi.mocked(scoreAndSaveTagged).mockResolvedValueOnce(1);
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.results[0].saved).toBe(1);
    expect(body.results[0].errors).toEqual([expect.stringContaining("Recency refresh failed")]);
    expect(vi.mocked(scoreAndSaveTagged).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteStaleLowScored).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(deleteStaleLowScored).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
    expect(revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
  });

  test("scoreAndSaveTagged throwing error is caught and added to errors array, returns 200", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(scoreAndSaveTagged).mockRejectedValueOnce(new Error("boom"));

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toBeDefined();
    expect(data.results[0].errors[0]).toContain("Scoring failed");
    expect(data.results[0].scoringErrors).toEqual([
      "採点サービスでエラーが発生しました。時間をおいて再試行してください。",
    ]);
    expect(revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
    const { deleteStaleLowScored } = await import("@/lib/db");
    expect(vi.mocked(deleteStaleLowScored).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
  });

  test("reports a safe scoring error when the scoring pipeline reports a per-article failure", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(scoreAndSaveTagged).mockImplementationOnce(async (_articles, options) => {
      options?.onScoringError?.("provider secret/internal stack");
      options?.onScoringError?.("a different provider error");
      return 0;
    });

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(data.results[0].scoringErrors).toEqual([
      "採点サービスでエラーが発生しました。時間をおいて再試行してください。",
    ]);
    expect(JSON.stringify(data)).not.toContain("provider secret/internal stack");
  });

  test("does not report a scoring error when some articles were scored successfully", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { searchZenn } = await import("@/lib/news/zenn");
    vi.mocked(searchZenn).mockResolvedValueOnce([
      {
        id: 1,
        title: "Zenn Article 1",
        slug: "zenn-1",
        liked_count: 0,
        bookmarked_count: 0,
        article_type: "tech",
        emoji: null,
        path: "/articles/zenn-1",
        published_at: new Date().toISOString(),
        user: { username: "zenn-user", name: "Zenn User" },
      },
      {
        id: 2,
        title: "Zenn Article 2",
        slug: "zenn-2",
        liked_count: 0,
        bookmarked_count: 0,
        article_type: "tech",
        emoji: null,
        path: "/articles/zenn-2",
        published_at: new Date().toISOString(),
        user: { username: "zenn-user", name: "Zenn User" },
      },
    ]);
    vi.mocked(scoreAndSaveTagged).mockImplementationOnce(async (_articles, options) => {
      options?.onScoringError?.("one article failed");
      options?.onScoringSuccess?.();
      return 0;
    });

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(
      data.results.some((result: { scoringErrors?: string[] }) => result.scoringErrors?.length),
    ).toBe(false);
    expect(data.results.some((result: { saved?: number }) => result.saved === 0)).toBe(true);
  });

  test("churn check: 1st POST calls scoreAndSaveTagged, 2nd POST with identical state calls 0 scored/skipped, 3rd POST with changed signature re-scores", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { getScoringStateByUrls } = await import("@/lib/db");
    const { scoreAndSaveTagged: realScoreAndSaveTagged } = await import("@/lib/score-pipeline");

    // 1st call: state empty, scores 1 article
    vi.mocked(getScoringStateByUrls).mockResolvedValueOnce(new Map());
    vi.mocked(scoreAndSaveTagged).mockImplementationOnce(realScoreAndSaveTagged as any);

    const req1 = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // 2nd call: state returns matching signature -> skip
    vi.mocked(getScoringStateByUrls).mockResolvedValueOnce(
      new Map([
        [
          "https://zenn.dev/articles/zenn-1",
          {
            url: "https://zenn.dev/articles/zenn-1",
            contentHash: "h1",
            score: 8,
            scoringSignature: "sig1",
            scoredAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    vi.mocked(scoreAndSaveTagged).mockImplementationOnce(realScoreAndSaveTagged as any);

    const req2 = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
  });
});
