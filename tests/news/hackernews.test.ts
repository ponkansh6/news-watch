import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchHackerNews } from "@/lib/news/hackernews";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchHackerNews", () => {
  test("happy path - returns articles when fetch succeeds", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        hits: [
          {
            title: "Test Hacker News Article 1",
            url: "https://hn.algolia.com/item1",
            author: "user1",
            points: 100,
            num_comments: 10,
            created_at: "2024-01-01T00:00:00Z",
            objectID: "1",
            _tags: ["story"],
            story_text: "Description 1",
          },
          {
            title: "Test Hacker News Article 2",
            url: "https://hn.algolia.com/item2",
            author: "user2",
            points: 200,
            num_comments: 20,
            created_at: "2024-01-02T00:00:00Z",
            objectID: "2",
            _tags: ["story"],
          },
        ],
        nbHits: 2,
        page: 1,
        nbPages: 1,
      }),
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchHackerNews(20);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Test Hacker News Article 1");
    expect(result[1].title).toBe("Test Hacker News Article 2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=20",
      { signal: expect.any(Object) },
    );
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchHackerNews(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchHackerNews(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
