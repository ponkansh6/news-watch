// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches favorite IDs on mount", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ids: [42] }),
    } as Response);

    render(<ArticleList articles={[mockArticle]} />);

    expect(fetchSpy).toHaveBeenCalledWith("/api/favorites");
  });

  it("does not toggle favorite on fewer than 5 taps", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      return { ok: true, json: async () => ({ favorited: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/favorites");
    });

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Tap 4 times
    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    const toggleCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("toggles favorite on 5 taps", async () => {
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/favorites");
    });

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Tap 5 times
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
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

  it("resets tap counter after timeout between taps", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      return { ok: true, json: async () => ({ favorited: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Tap 4 times
    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    // Advance time beyond 4000ms timeout
    vi.advanceTimersByTime(4500);

    // Tap 1 more time (should be treated as 1st tap of a new sequence)
    fireEvent.pointerDown(wrapperEl);

    const toggleCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("shows success message when toggle favorite adds or removes article", async () => {
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/favorites");
    });

    const wrapperEl = screen.getByText("Test summary").parentElement!;
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    await waitFor(() => {
      expect(screen.getByText("お気に入りに登録しました")).toBeInTheDocument();
    });

    // Mock un-favoriting next
    fetchMock.mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [42] }) };
      }
      if (url === "/api/favorites/toggle") {
        return { ok: true, json: async () => ({ favorited: false }) };
      }
      return { ok: false };
    });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    await waitFor(() => {
      expect(screen.getByText("お気に入りを解除しました")).toBeInTheDocument();
    });
  });

  it("shows error message when toggle favorite fails (API error)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) };
      }
      if (url === "/api/favorites/toggle") {
        return { ok: false, status: 500 };
      }
      return { ok: false };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/favorites");
    });

    const wrapperEl = screen.getByText("Test summary").parentElement!;
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    await waitFor(() => {
      expect(screen.getByText(/お気に入りの更新に失敗しました/)).toBeInTheDocument();
    });

    // Close error by clicking close button
    const closeBtn = screen.getByRole("button", { name: "閉じる" });
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/お気に入りの更新に失敗しました/)).not.toBeInTheDocument();
  });
});
