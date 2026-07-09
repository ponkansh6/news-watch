import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from "vitest";
import { searchNewsApi } from "@/lib/news/newsapi";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("searchNewsApi", () => {
  test("happy path - returns articles when API key is set and fetch succeeds", async () => {
    process.env.NEWS_API_KEY = "test-key";
    const mockResponse = {
      ok: true,
      json: async () => ({
        status: "ok",
        totalResults: 2,
        articles: [
          {
            title: "Test Article 1",
            description: "Description 1",
            url: "https://example.com/1",
            urlToImage: "https://example.com/image1.jpg",
            publishedAt: "2024-01-01T00:00:00Z",
            source: { name: "Test Source", id: "test-source" },
            author: "Author 1",
          },
          {
            title: "Test Article 2",
            description: "Description 2",
            url: "https://example.com/2",
            urlToImage: null,
            publishedAt: "2024-01-02T00:00:00Z",
            source: { name: "Test Source 2", id: "test-source-2" },
            author: null,
          },
        ],
      }),
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchNewsApi("test keyword");

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Test Article 1");
    expect(result[1].title).toBe("Test Article 2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://newsapi.org/v2/everything?q=test%20keyword&apiKey=test-key&pageSize=30&language=en&sortBy=publishedAt",
      { signal: expect.any(Object) },
    );
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    process.env.NEWS_API_KEY = "test-key";
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchNewsApi("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    process.env.NEWS_API_KEY = "test-key";
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchNewsApi("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("API key not set - returns empty array without calling fetch", async () => {
    process.env.NEWS_API_KEY = "";

    const result = await searchNewsApi("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
