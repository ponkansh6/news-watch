import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLM_MODEL, scoreArticle, scoreArticles } from "../../../src/lib/llm/gemini";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("gemini llm module", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GROQ_API_KEY = "test-api-key";
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  it("exports the correct LLM_MODEL", () => {
    expect(LLM_MODEL).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
  });

  describe("scoreArticle", () => {
    it("returns null if API key is missing", async () => {
      delete process.env.GROQ_API_KEY;
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns parsed response on success", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "test",
                relevance: 5,
                usefulness: 5,
                reason: "test",
              }),
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.groq.com"),
        expect.any(Object),
      );
    });

    it("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 500 }));
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on API error response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "moderation" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on invalid JSON", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "invalid" } }] }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("returns null on timeout", async () => {
      const error = new Error("AbortError");
      error.name = "AbortError";
      mockFetch.mockRejectedValue(error);

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toBeNull();
    });

    it("retries on HTTP 429 then succeeds", async () => {
      const okResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "test",
                relevance: 5,
                usefulness: 5,
                reason: "test",
              }),
            },
          },
        ],
      };
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(okResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const result = await scoreArticle({ title: "test", description: "test" }, "keyword");
      expect(result).toEqual({ summary: "test", relevance: 5, usefulness: 5, reason: "test" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
        choices: [
          {
            message: {
              content: JSON.stringify([
                { summary: "s1", relevance: 1, usefulness: 1, reason: "r1" },
                { summary: "s2", relevance: 2, usefulness: 2, reason: "r2" },
              ]),
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

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
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify([
                { summary: "s1", relevance: 1, usefulness: 1, reason: "r1" },
              ]),
            },
          },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

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
