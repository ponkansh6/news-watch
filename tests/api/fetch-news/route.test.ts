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
      topic: "NTT",
      summary: "Summary of article",
      reason: "Good reason",
    },
  ]),
  scoreArticle: vi.fn().mockResolvedValue({
    ntt_relevance: 9,
    usefulness: 8,
    topic: "NTT",
    summary: "Summary of article",
    reason: "Good reason",
  }),
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
});
