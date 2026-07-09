import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchGitHub } from "@/lib/news/github";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchGitHub", () => {
  test("happy path - returns repositories when fetch succeeds", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            name: "Test Repo 1",
            description: "Description 1",
            html_url: "https://github.com/test/repo1",
            owner: { login: "owner1" },
            created_at: "2024-01-01T00:00:00Z",
            stargazers_count: 100,
            language: "TypeScript",
          },
          {
            name: "Test Repo 2",
            description: "Description 2",
            html_url: "https://github.com/test/repo2",
            owner: { login: "owner2" },
            created_at: "2024-01-02T00:00:00Z",
            stargazers_count: 200,
            language: null,
          },
        ],
      }),
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchGitHub("test keyword");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Test Repo 1");
    expect(result[1].name).toBe("Test Repo 2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/search/repositories?q=test%20keyword&sort=stars&order=desc&per_page=30",
      {
        signal: expect.any(Object),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchGitHub("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchGitHub("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("with access token - includes Authorization header", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const mockResponse = {
      ok: true,
      json: async () => ({ items: [] }),
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchGitHub("test keyword");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/search/repositories?q=test%20keyword&sort=stars&order=desc&per_page=30",
      {
        signal: expect.any(Object),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: "Bearer test-token",
        },
      },
    );
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
