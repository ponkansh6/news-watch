import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchQiita } from "@/lib/news/qiita";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchQiita", () => {
  test("happy path - returns articles when fetch succeeds", async () => {
    const mockResponse = {
      ok: true,
      json: async () => [
        {
          id: "1",
          title: "Test Qiita Article 1",
          url: "https://qiita.com/1",
          created_at: "2024-01-01T00:00:00Z",
          user: { name: "user1", id: "user1" },
          tags: [{ name: "tag1" }],
          likes_count: 100,
          page_views_count: 1000,
        },
        {
          id: "2",
          title: "Test Qiita Article 2",
          url: "https://qiita.com/2",
          created_at: "2024-01-02T00:00:00Z",
          user: { name: "user2", id: "user2" },
          tags: [{ name: "tag2" }],
          likes_count: 200,
          page_views_count: 2000,
        },
      ],
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchQiita("test keyword");

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Test Qiita Article 1");
    expect(result[1].title).toBe("Test Qiita Article 2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qiita.com/api/v2/items?query=test%20keyword&page=1&per_page=30",
      expect.objectContaining({ signal: expect.any(Object) })
    );
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchQiita("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchQiita("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("with access token - includes Authorization header", async () => {
    vi.stubEnv("QIITA_ACCESS_TOKEN", "test-token");
    const mockResponse = {
      ok: true,
      json: async () => [],
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchQiita("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qiita.com/api/v2/items?query=test%20keyword&page=1&per_page=30",
      {
        signal: expect.any(Object),
        headers: { Authorization: "Bearer test-token" },
      }
    );
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});