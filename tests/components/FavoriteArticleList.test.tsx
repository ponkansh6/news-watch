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

  it("does not toggle favorite on short swipe (< 60px)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ favorited: true }) } as Response;
    });

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Short swipe (30px — below threshold)
    fireEvent.pointerDown(wrapperEl, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(wrapperEl, { clientX: 30, clientY: 0 });

    const toggleCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("does not toggle favorite on vertical swipe (too much drift)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ favorited: true }) } as Response;
    });

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Swipe with large vertical component (Y moves almost as much as X)
    fireEvent.pointerDown(wrapperEl, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(wrapperEl, { clientX: 100, clientY: 80 });

    const toggleCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("does not toggle on pointerCancel (browser takes over gesture)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (url === "/api/favorites") {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ favorited: true }) } as Response;
    });

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Start swipe then browser cancels (e.g. scroll takeover)
    fireEvent.pointerDown(wrapperEl, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(wrapperEl, { pointerId: 1 });
    // pointerUp after cancel should be ignored
    fireEvent.pointerUp(wrapperEl, { clientX: 100, clientY: 5, pointerId: 1 });

    const toggleCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("triggers /api/favorites/toggle on star button click", async () => {
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

    // Find and click the star button
    const starBtn = screen.getByRole("button", { name: "お気に入り登録" });
    fireEvent.click(starBtn);

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

  it("triggers /api/favorites/toggle on horizontal swipe >= 60px", async () => {
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

    // Swipe right 100px
    fireEvent.pointerDown(wrapperEl, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(wrapperEl, { clientX: 100, clientY: 5 });

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

    const starBtn = screen.getByRole("button", { name: "お気に入り登録" });
    fireEvent.click(starBtn);

    await waitFor(() => {
      expect(screen.getByText(/お気に入りの更新に失敗しました/)).toBeInTheDocument();
    });

    // Close error by clicking close button
    const closeBtn = screen.getByRole("button", { name: "閉じる" });
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/お気に入りの更新に失敗しました/)).not.toBeInTheDocument();
  });
});
