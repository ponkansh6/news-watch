import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/favorites/analyze/route";
import {
  getFavoriteStats,
  getLatestPreferenceProfile,
  getFavoriteArticles,
  savePreferenceProfile,
} from "@/lib/db";
import {
  analyzeFavorites,
  isUsablePreferenceAnalysis,
  buildPreferencePromptSection,
} from "@/lib/llm";
import { revalidateTag } from "next/cache";

vi.mock("@/lib/db", () => ({
  getFavoriteStats: vi.fn(),
  getLatestPreferenceProfile: vi.fn(),
  getFavoriteArticles: vi.fn(),
  savePreferenceProfile: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  analyzeFavorites: vi.fn(),
  isUsablePreferenceAnalysis: vi.fn(),
  buildPreferencePromptSection: vi.fn(),
  LLM_MODEL: "test-model",
}));

describe("POST /api/favorites/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("件数不足 400", async () => {
    vi.mocked(getFavoriteStats).mockResolvedValueOnce({ count: 3, maxId: 10 });

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "Not enough favorites to analyze",
      required: 5,
      current: 3,
    });
  });

  it("クールダウン中 429 + Retry-After", async () => {
    vi.mocked(getFavoriteStats).mockResolvedValueOnce({ count: 5, maxId: 10 });
    vi.mocked(getLatestPreferenceProfile).mockResolvedValueOnce({
      id: 1,
      version: 1,
      createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      favoriteCount: 5,
      favoriteMaxId: 5,
      model: "test-model",
      analysis: { summary: "test", themes: [], traits: [], dislikes: [], scoringGuidance: [] },
      promptSection: "test",
    });

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toBe("Analysis cooldown active");
    expect(typeof json.retryAfterMs).toBe("number");
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  it("無変化 → reused:true, LLM未呼び出し", async () => {
    vi.mocked(getFavoriteStats).mockResolvedValueOnce({ count: 5, maxId: 10 });
    vi.mocked(getLatestPreferenceProfile).mockResolvedValueOnce({
      id: 1,
      version: 1,
      createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      favoriteCount: 5,
      favoriteMaxId: 10,
      model: "test-model",
      analysis: {
        summary: "old summary",
        themes: ["theme1"],
        traits: [],
        dislikes: [],
        scoringGuidance: [],
      },
      promptSection: "old prompt",
    });

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      reused: true,
      profile: {
        summary: "old summary",
        themes: ["theme1"],
        createdAt: expect.any(String),
        favoriteCount: 5,
      },
    });
    expect(analyzeFavorites).not.toHaveBeenCalled();
  });

  it("正常 200 + revalidateTag", async () => {
    vi.mocked(getFavoriteStats).mockResolvedValueOnce({ count: 5, maxId: 10 });
    vi.mocked(getLatestPreferenceProfile).mockResolvedValueOnce(null);
    vi.mocked(getFavoriteArticles).mockResolvedValueOnce([
      {
        id: 1,
        title: "Article 1",
        url: "https://example.com/1",
        publishedAt: new Date().toISOString(),
        sourceName: "Source 1",
        sourceId: "src-1",
        keyword: "kw",
        summary: "Summary 1",
        relevance: 5,
        usefulness: 5,
        recency: 5,
        score: 90,
        reason: "Good",
        keywordLabel: "Keyword 1",
      },
    ]);

    const mockAnalysis = {
      summary: "New summary",
      themes: ["t1"],
      traits: [],
      dislikes: [],
      scoringGuidance: [],
    };
    vi.mocked(analyzeFavorites).mockResolvedValueOnce(mockAnalysis);
    vi.mocked(isUsablePreferenceAnalysis).mockReturnValueOnce(true);
    vi.mocked(buildPreferencePromptSection).mockReturnValueOnce("prompt section");

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.reused).toBe(false);
    expect(json.profile.summary).toBe("New summary");
    expect(savePreferenceProfile).toHaveBeenCalledWith({
      analysis: mockAnalysis,
      promptSection: "prompt section",
      favoriteCount: 5,
      favoriteMaxId: 10,
      model: "test-model",
    });
    expect(revalidateTag).toHaveBeenCalledWith("preference-profile", "max");
  });

  it("分析 null → 502（保存なし）", async () => {
    vi.mocked(getFavoriteStats).mockResolvedValueOnce({ count: 5, maxId: 10 });
    vi.mocked(getLatestPreferenceProfile).mockResolvedValueOnce(null);
    vi.mocked(getFavoriteArticles).mockResolvedValueOnce([]);
    vi.mocked(analyzeFavorites).mockResolvedValueOnce(null);
    vi.mocked(isUsablePreferenceAnalysis).mockReturnValueOnce(false);

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({ error: "Analysis failed" });
    expect(savePreferenceProfile).not.toHaveBeenCalled();
  });

  it("DB throw → 500", async () => {
    vi.mocked(getFavoriteStats).mockRejectedValueOnce(new Error("DB error"));

    const req = new Request("http://localhost/api/favorites/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Internal Server Error" });
  });
});
