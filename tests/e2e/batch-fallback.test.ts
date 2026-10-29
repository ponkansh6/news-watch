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
    });
    expect(results[1]).toEqual({
      summary: "個別スコアリングのサマリーです2 (20文字以上)",
      usefulness: 9,
      reason: "個別成功2",
      ntt_relevance: 9,
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

  it("runs fallback scoring sequentially and stops when the shared deadline expires", async () => {
    let finishFirstFallback!: (result: { response: { text: () => string } }) => void;
    const firstFallback = new Promise<{ response: { text: () => string } }>((resolve) => {
      finishFirstFallback = resolve;
    });
    let firstFallbackTimeout = 0;
    mockGenerateContent.mockImplementation((_prompt, options) => {
      const callNumber = mockGenerateContent.mock.calls.length;
      if (callNumber <= 3) {
        return Promise.resolve({ response: { text: () => `invalid json batch ${callNumber}` } });
      }
      if (callNumber === 4) {
        firstFallbackTimeout = options.timeout;
        return firstFallback;
      }
      return Promise.resolve({ response: { text: () => "{}" } });
    });

    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const scoring = scoreArticles(
      [
        { title: "Article 1", description: "Desc 1" },
        { title: "Article 2", description: "Desc 2" },
      ],
      "",
      { timeoutMs: 1000, retries: 0 },
    );
    await vi.waitFor(() => expect(mockGenerateContent).toHaveBeenCalledTimes(4));
    expect(firstFallbackTimeout).toBeLessThanOrEqual(1000);

    nowSpy.mockReturnValue(now + 1001);
    finishFirstFallback({
      response: {
        text: () =>
          JSON.stringify({
            summary: "個別スコアリングのサマリーです (20文字以上)",
            usefulness: 8,
            reason: "個別成功",
            ntt_relevance: 8,
          }),
      },
    });
    const results = await scoring;
    nowSpy.mockRestore();

    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    expect(results).toHaveLength(2);
    expect(results[0]?.usefulness).toBe(8);
    expect(results[1]).toBeNull();
  });
});
