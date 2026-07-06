import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLM_MODEL, scoreArticle, scoreArticles } from "../../../src/lib/llm/gemini";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("gemini llm module", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_API_KEY = "test-api-key";
  });

  afterEach(() => {
    delete process.env.GOOGLE_API_KEY;
  });

  it("exports the correct LLM_MODEL", () => {
    expect(LLM_MODEL).toBe("gemma-4-31b-it");
  });

  describe("scoreArticle", () => {
    it("returns null if API key is missing", async () => {
      delete process.env.GOOGLE_API_KEY;
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns parsed response on success", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ summary: "test", relevance: 5, usefulness: 5, reason: "test" }) }],
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(LLM_MODEL),
        expect.any(Object)
      );
    });

    it("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on blocked response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ promptFeedback: { blockReason: "Safety" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on invalid JSON", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "invalid" }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on timeout", async () => {
      mockFetch.mockRejectedValue(new Error("AbortError"));
      // Need to mock the error name property
      const error = new Error("AbortError");
      error.name = "AbortError";
      mockFetch.mockRejectedValue(error);

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("filters out thought parts", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                { text: "thinking...", thought: true },
                { text: JSON.stringify({ summary: "test", relevance: 5, usefulness: 5, reason: "test" }) },
              ],
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
    });
  });

  describe("scoreArticles", () => {
    it("returns empty array for empty input", async () => {
      const result = await scoreArticles([], "keyword");
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns array of results on success", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { summary: "s1", relevance: 1, usefulness: 1, reason: "r1" },
                    { summary: "s2", relevance: 2, usefulness: 2, reason: "r2" },
                  ]),
                },
              ],
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await scoreArticles(
        [
          { title: "t1", description: "d1" },
          { title: "t2", description: "d2" },
        ],
        "keyword"
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ summary: "s1", relevance: 1, usefulness: 1, reason: "r1" });
      expect(result[1]).toEqual({ summary: "s2", relevance: 2, usefulness: 2, reason: "r2" });
    });

    it("pads with null if results are missing", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { summary: "s1", relevance: 1, usefulness: 1, reason: "r1" },
                  ]),
                },
              ],
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await scoreArticles(
        [
          { title: "t1", description: "d1" },
          { title: "t2", description: "d2" },
        ],
        "keyword"
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ summary: "s1", relevance: 1, usefulness: 1, reason: "r1" });
      expect(result[1]).toBeNull();
    });
  });
});
