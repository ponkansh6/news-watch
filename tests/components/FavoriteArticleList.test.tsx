// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../lib/test-utils";
import { ArticleList, type ArticleListRow as Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const mockArticle: Article = {
  id: 42,
  title: "Test Article Title",
  url: "https://example.com/article",
  publishedAt: "2026-01-01T00:00:00Z",
  sourceName: "Zenn",
  sourceId: "zenn",
  keyword: "test",
  keywordLabel: "Test",
  summary: "Test summary",
  relevance: 8,
  usefulness: 8,
  recency: 8,
  score: 8,
  reason: "This is a great reason for testing",
};

describe("FavoriteArticleList Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not toggle favorite on fewer than 5 taps", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Tap 4 times
    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    const toggleCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(0);
  });

  it("toggles favorite on 5 taps", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;

    // Tap 5 times
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    const toggleCalls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(toggleCalls).toHaveLength(1);
    expect(toggleCalls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ articleId: 42 }),
    });
  });

  it("resets tap counter after timeout between taps", () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    const wrapperEl = screen.getByText("Test summary").parentElement!;
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    await waitFor(() => {
      expect(screen.getByText("お気に入りに登録しました")).toBeInTheDocument();
    });

    // Mock un-favoriting next
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: false }),
    });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(wrapperEl);
    }

    await waitFor(() => {
      expect(screen.getByText("お気に入りを解除しました")).toBeInTheDocument();
    });
  });

  it("shows error message when toggle favorite fails (API error)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

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
