import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreArticles } from "@/lib/llm";

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel = vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });
    },
  };
});

describe("batch-fallback e2e/integration test", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_API_KEY = "test-api-key";
    vi.stubGlobal(
      "setTimeout",
      vi.fn((cb) => cb()),
    );
  });

  it("falls back to individual scoring when batch parsing fails across all parse retries", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 1" } })
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 2" } })
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 3" } })
      // Individual fallback for article 1
      .mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              summary: "個別スコアリングのサマリーです (20文字以上)",
              usefulness: 8,
              reason: "個別成功",
              ntt_relevance: 8,
              topic: "NTT",
            }),
        },
      })
      // Individual fallback for article 2
      .mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              summary: "個別スコアリングのサマリーです2 (20文字以上)",
              usefulness: 9,
              reason: "個別成功2",
              ntt_relevance: 9,
              topic: "NTT",
            }),
        },
      });

    const results = await scoreArticles([
      { title: "Article 1", description: "Desc 1" },
      { title: "Article 2", description: "Desc 2" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      summary: "個別スコアリングのサマリーです (20文字以上)",
      usefulness: 8,
      reason: "個別成功",
      ntt_relevance: 8,
      topic: "NTT",
    });
    expect(results[1]).toEqual({
      summary: "個別スコアリングのサマリーです2 (20文字以上)",
      usefulness: 9,
      reason: "個別成功2",
      ntt_relevance: 9,
      topic: "NTT",
    });
  });

  it("returns null scores if individual scoring also fails after batch failure", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 1" } })
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 2" } })
      .mockResolvedValueOnce({ response: { text: () => "invalid json batch 3" } })
      // Individual fallback fails for article 1 and 2
      .mockRejectedValueOnce(new Error("API Error 1"))
      .mockRejectedValueOnce(new Error("API Error 2"));

    const results = await scoreArticles([
      { title: "Article 1", description: "Desc 1" },
      { title: "Article 2", description: "Desc 2" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });
});
