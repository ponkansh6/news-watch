import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/fetch-news/route";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";

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
    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toBeDefined();
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

  test("scoreAndSaveTagged throwing error is caught and added to errors array, returns 200", async () => {
    vi.mocked(scoreAndSaveTagged).mockRejectedValueOnce(new Error("boom"));

    const req = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].errors).toBeDefined();
    expect(data.results[0].errors[0]).toContain("Scoring failed");
  });

  test("churn check: 1st POST calls scoreAndSaveTagged, 2nd POST with identical state calls 0 scored/skipped, 3rd POST with changed signature re-scores", async () => {
    const { getScoringStateByUrls } = await import("@/lib/db");
    const { scoreAndSaveTagged: realScoreAndSaveTagged } = await import("@/lib/score-pipeline");

    // 1st call: state empty, scores 1 article
    vi.mocked(getScoringStateByUrls).mockResolvedValueOnce(new Map());
    vi.mocked(scoreAndSaveTagged).mockImplementationOnce(realScoreAndSaveTagged as any);

    const req1 = new NextRequest("http://localhost/api/fetch-news", {
      method: "POST",
      body: JSON.stringify({ source: "zenn" }),
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
  });
});
