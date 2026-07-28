// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ArticleList, { type Article } from "@/app/article-list";
import "@testing-library/jest-dom/vitest";

const mockArticle: Article = {
  id: 42,
  title: "Test Article Title",
  description: "Test description",
  url: "https://example.com/article",
  urlToImage: null,
  publishedAt: "2026-01-01T00:00:00Z",
  sourceName: "Zenn",
  sourceId: "zenn",
  author: "Author",
  keyword: "test",
  summary: "Test summary",
  relevance: 8,
  usefulness: 8,
  recency: 8,
  score: 8,
  reason: "This is a great reason for testing",
  scoredAt: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("FavoriteArticleList Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches favorite IDs on mount", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ids: [42] }),
    } as Response);

    render(<ArticleList articles={[mockArticle]} />);

    expect(fetchSpy).toHaveBeenCalledWith("/api/favorites");
  });

  it("does not toggle favorite on fewer than 5 clicks within 2 seconds", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ favorited: true }) } as Response;
    });

    render(<ArticleList articles={[mockArticle]} />);

    const summaryEl = screen.getByText("Test summary");

    // Click 4 times
    for (let i = 0; i < 4; i++) {
      fireEvent.click(summaryEl);
    }

    // Verify /api/favorites/toggle was NOT called
    const toggleCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("triggers /api/favorites/toggle on 5 consecutive clicks within 2 seconds", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      if (url === "/api/favorites/toggle") {
        return { ok: true, json: async () => ({ favorited: true }) };
      }
      return { ok: false };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    // Wait for initial fetch
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/favorites");
    });

    const summaryEl = screen.getByText("Test summary");

    // Click 5 times rapidly
    for (let i = 0; i < 5; i++) {
      fireEvent.click(summaryEl);
    }

    await waitFor(() => {
      const toggleCalls = fetchMock.mock.calls.filter(
        (call) => call[0] === "/api/favorites/toggle",
      );
      expect(toggleCalls).toHaveLength(1);
      expect(toggleCalls[0][1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ articleId: 42 }),
      });
    });
  });
});
