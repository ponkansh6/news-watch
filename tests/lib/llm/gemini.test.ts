import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLM_MODEL, scoreArticle, scoreArticles } from "../../../src/lib/llm/gemini";

// Mock @google/generative-ai
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

describe("gemini llm module", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_API_KEY = "test-api-key";
    vi.stubGlobal(
      "setTimeout",
      vi.fn((cb) => cb()),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the correct LLM_MODEL", () => {
    expect(LLM_MODEL).toBe("gemini-3.1-flash-lite");
  });

  describe("scoreArticle", () => {
    it("returns null if API key is missing", async () => {
      delete process.env.GOOGLE_API_KEY;
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("returns parsed response on success", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              summary: "test",
              relevance: 5,
              usefulness: 5,
              reason: "test",
            }),
        },
      });

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it("returns null on API error", async () => {
      mockGenerateContent.mockRejectedValue(new Error("API Error"));
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on invalid JSON", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => "invalid",
        },
      });
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("retries on 429 then succeeds", async () => {
      const okResponse = {
        response: {
          text: () =>
            JSON.stringify({
              summary: "test",
              relevance: 5,
              usefulness: 5,
              reason: "test",
            }),
        },
      };
      // Simulate 429 error (SDK throws error with status 429)
      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).status = 429;

      mockGenerateContent.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce(okResponse);

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("scoreArticles", () => {
    it("returns empty array for empty input", async () => {
      const result = await scoreArticles([], "keyword");
      expect(result).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("returns array of results on success", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify([
              { summary: "s1", relevance: 1, usefulness: 1, reason: "r1" },
              { summary: "s2", relevance: 2, usefulness: 2, reason: "r2" },
            ]),
        },
      });

      const result = await scoreArticles(
        [
          { title: "t1", description: "d1" },
          { title: "t2", description: "d2" },
        ],
        "keyword",
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ summary: "s1", relevance: 1, usefulness: 1, reason: "r1" });
      expect(result[1]).toEqual({ summary: "s2", relevance: 2, usefulness: 2, reason: "r2" });
    });

    it("pads with null if results are missing", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify([{ summary: "s1", relevance: 1, usefulness: 1, reason: "r1" }]),
        },
      });

      const result = await scoreArticles(
        [
          { title: "t1", description: "d1" },
          { title: "t2", description: "d2" },
        ],
        "keyword",
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ summary: "s1", relevance: 1, usefulness: 1, reason: "r1" });
      expect(result[1]).toBeNull();
    });
  });
});
